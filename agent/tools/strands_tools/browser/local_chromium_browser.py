"""
Local Chromium Browser implementation using Playwright.

This module provides a local Chromium browser implementation that runs
browser instances on the local machine using Playwright.
"""

import asyncio
import logging
import os
from typing import Any, Dict, Optional

from playwright.async_api import Browser as PlaywrightBrowser
from playwright.async_api import Page
from .models import (
    NavigateAction, NewTabAction, SwitchTabAction, CloseTabAction,
    ClickAction, TypeAction, EvaluateAction, BackAction, ForwardAction, RefreshAction,
    GetTextAction, GetHtmlAction, ScreenshotAction
)

from .browser import Browser
from strands_tools.utils.image_processing import cache_image_bytes, compress_image_bytes, load_screenshot_config

logger = logging.getLogger(__name__)


class LocalChromiumBrowser(Browser):
    """Local Chromium browser implementation using Playwright."""

    def __init__(
        self, launch_options: Optional[Dict[str, Any]] = None, context_options: Optional[Dict[str, Any]] = None
    ):
        """
        Initialize the local Chromium browser.

        Args:
            launch_options: Chromium-specific launch options (headless, args, etc.)
            context_options: Browser context options (viewport, user agent, etc.)
        """
        super().__init__()
        self._launch_options = launch_options or {}
        self._context_options = context_options or {}
        self._default_launch_options: Dict[str, Any] = {}
        self._default_context_options: Dict[str, Any] = {}
        # Cache for fast lookups
        self._cached_shell_page: Optional[Page] = None
        # Cache CDP browser connection (can only connect once)
        self._cdp_browser: Optional[PlaywrightBrowser] = None

    async def start_platform(self) -> None:
        """Initialize the local Chromium browser platform with configuration (ASYNC)."""
        # Read environment variables
        user_data_dir = os.getenv(
            "STRANDS_BROWSER_USER_DATA_DIR", os.path.join(os.path.expanduser("~"), ".browser_automation")
        )
        headless = os.getenv("STRANDS_BROWSER_HEADLESS", "false").lower() == "true"
        width = int(os.getenv("STRANDS_BROWSER_WIDTH", "1280"))
        height = int(os.getenv("STRANDS_BROWSER_HEIGHT", "800"))

        # Ensure user data directory exists
        os.makedirs(user_data_dir, exist_ok=True)

        # Build default launch options
        self._default_launch_options = {
            "headless": headless,
            "args": [f"--window-size={width},{height}"],
        }
        self._default_launch_options.update(self._launch_options)

        self._default_context_options = {"viewport": {"width": width, "height": height}}
        self._default_context_options.update(self._context_options)

        # CDP Connection Handling (Fix for "Browser Not Working")
        # Check env vars for explicit CDP URL, otherwise default to standard localhost:9222
        # This ensures we attach to the running Electron app by default instead of spawning a hidden browser.
        cdp_url = os.getenv("STRANDS_BROWSER_CDP_URL") or os.getenv("CDP_URL") or "http://localhost:9222"
        if cdp_url:
            self._default_launch_options["cdp_url"] = cdp_url
            logger.info(f"Configured to attach to browser via CDP at {cdp_url}")

    async def create_browser_session(self) -> PlaywrightBrowser:
        """Create a new local Chromium browser instance for a session."""
        if not self._playwright:
            raise RuntimeError("Playwright not initialized")

        # Connect to existing CDP session if configured
        if "cdp_url" in self._default_launch_options:
            # CACHE THE CDP CONNECTION - can only connect once
            if self._cdp_browser:
                logger.info("Reusing cached CDP browser connection")
                return self._cdp_browser

            cdp_url = self._default_launch_options["cdp_url"]
            logger.info(f"Connecting to existing browser via CDP: {cdp_url}")

            # Retry loop for socket connection (handles race condition where Electron starts slower than Python)
            last_error = None

            # Try for 30 seconds (60 attempts * 0.5s)
            logger.info(f"Connecting to CDP at {cdp_url}...")
            for i in range(60):
                try:
                    # Set a short timeout (2s) so we don't hang if the socket is open but silent
                    self._cdp_browser = await self._playwright.chromium.connect_over_cdp(cdp_url, timeout=2000)
                    logger.info("✅ CDP connection established and cached")
                    return self._cdp_browser
                except Exception as e:
                    last_error = e
                    if i % 10 == 0: # Log every 5 seconds
                        logger.info(f"Waiting for Electron CDP... ({i+1}/60) - Ensure Electron is running.")
                    await asyncio.sleep(0.5)

            # If all retries fail, raise the last error
            logger.error(f"Failed to connect to CDP at {cdp_url} after 30 seconds.")
            raise RuntimeError(f"Failed to connect to CDP at {cdp_url}. Is Electron running? Error: {last_error}")

        # Handle persistent context if specified
        if self._default_launch_options.get("persistent_context"):
            persistent_user_data_dir = self._default_launch_options.get(
                "user_data_dir", os.path.join(os.path.expanduser("~"), ".browser_automation")
            )

            # For persistent context, return the context itself as it acts like a browser
            return await self._playwright.chromium.launch_persistent_context(
                user_data_dir=persistent_user_data_dir,
                **{
                    k: v
                    for k, v in self._default_launch_options.items()
                    if k not in ["persistent_context", "user_data_dir"]
                },
            )
        else:
            # Regular browser launch
            logger.debug("launching local Chromium session browser with options: %s", self._default_launch_options)
            return await self._playwright.chromium.launch(**self._default_launch_options)

    async def close_platform(self) -> None:
        """Close the local Chromium browser. No platform specific changes needed (ASYNC)."""
        pass

    async def _setup_session_from_browser(self, browser_or_context):
        """Setup session components from browser or context."""
        import asyncio
        if isinstance(browser_or_context, PlaywrightBrowser):
            # If we are connected via CDP (Electron), try to find existing pages first
            # to ensure we attach to the window that has the Preload API loaded.
            if "cdp_url" in self._default_launch_options:
                session_browser = browser_or_context
                contexts = session_browser.contexts

                # Playwright docs: default context is available via browser.contexts[0].
                if contexts:
                    session_context = contexts[0]
                    if session_context.pages:
                        session_page = session_context.pages[0]
                    else:
                        session_page = await session_context.new_page()
                else:
                    logger.warning("No existing contexts found in Electron CDP. Creating new context (fallback).")
                    session_context = await session_browser.new_context()
                    session_page = await session_context.new_page()

                async def _is_shell(page: Page) -> bool:
                    try:
                        return await asyncio.wait_for(page.evaluate("!!window.electron"), timeout=1.0)
                    except Exception:
                        return False

                # Prefer the default page, then do a single bounded scan for the shell.
                if await _is_shell(session_page):
                    self._cached_shell_page = session_page
                    logger.info("Confirmed attached page is the Electron Shell ✅")
                else:
                    target_context = None
                    target_page = None
                    for ctx in contexts:
                        for page in ctx.pages:
                            if page is session_page:
                                continue
                            if await _is_shell(page):
                                target_context = ctx
                                target_page = page
                                logger.info(f"Found Electron Shell via window.electron at: {page.url}")
                                break
                        if target_page:
                            break

                    if target_context and target_page:
                        session_context = target_context
                        session_page = target_page
                        self._cached_shell_page = target_page
                    else:
                        logger.warning(
                            "Shell page not found via window.electron; using default context/page for CDP session."
                        )
            else:
                # Normal non-persistent case
                session_browser = browser_or_context
                session_context = await session_browser.new_context()
                session_page = await session_context.new_page()
        else:
            # Persistent context case
            session_context = browser_or_context
            session_browser = session_context.browser
            session_page = await session_context.new_page()

        return session_browser, session_context, session_page

    def _get_all_pages(self) -> list:
        """Get all pages from all sessions."""
        pages = []
        for session in self._sessions.values():
            if session.context and session.context.pages:
                pages.extend(session.context.pages)
        return pages

    async def _get_shell_page(self) -> Optional[Page]:
        """Find the Electron Shell Page. Uses cache for speed."""
        import asyncio
        # Return cached if still valid
        if self._cached_shell_page:
            try:
                # Quick check if page is still open
                if not self._cached_shell_page.is_closed():
                    return self._cached_shell_page
            except:
                pass
            self._cached_shell_page = None
        
        # Find and cache
        for session in self._sessions.values():
            if not session.context:
                continue
            for page in session.context.pages:
                try:
                    # Fix: Use asyncio.wait_for instead of invalid timeout arg
                    is_shell = await asyncio.wait_for(
                        page.evaluate("!!window.electron"), 
                        timeout=5.0
                    )
                    if is_shell:
                        self._cached_shell_page = page
                        logger.info(f"Re-acquired Shell Page: {page.url}")
                        return page
                except:
                    continue
        return None

    async def _get_active_content_page(self, shell_page: Page) -> Optional[Page]:
        """Find the active content page. Fast path using URL match."""
        import asyncio
        try:
            print("DEBUG: _get_active_content_page running fixed version with asyncio.wait_for")
            # Get active tab URL
            # Fix: page.evaluate does not accept timeout argument
            target_url = await asyncio.wait_for(
                shell_page.evaluate(
                    "window.electron.tabs.list().then(tabs => (tabs.find(t => t.isActive) || {}).url)"
                ),
                timeout=5.0
            )
            
            logger.info(f"DEBUG: Tabs API reports active URL: {target_url}")
            
            if not target_url:
                logger.warning("DEBUG: No active URL returned from Tabs API")
                return None
            
            # Find matching page
            candidates = []
            for session in self._sessions.values():
                if not session.context:
                    continue
                for p in session.context.pages:
                     if p != shell_page:
                         candidates.append(p.url)
                         # Loose matching to handle trailing slashes
                         # Normalize both to remove trailing slash for comparison
                         p_url_norm = p.url.rstrip("/")
                         t_url_norm = target_url.rstrip("/")
                         
                         if p_url_norm == t_url_norm:
                             logger.info(f"DEBUG: Found matching content page: {p.url}")
                             return p
            
            logger.warning(f"DEBUG: No matching Playwright page found for {target_url}. Candidates: {candidates}")
            return None
        except Exception as e:
            logger.error(f"Error finding content page: {e}")
            return None

    # --- App-Aware Action Overrides ---
    # CRITICAL: These methods MUST use window.electron and NEVER fall back to page.goto()
    # Falling back would navigate the shell page, destroying the React app!

    async def _async_navigate(self, action: NavigateAction) -> Dict[str, Any]:
        """Override: Use Shell API to navigate the active tab. NEVER use page.goto()."""
        shell = await self._get_shell_page()
        if shell:
            logger.info(f"Using Shell API to navigate to {action.url}")
            try:
                # Escape single quotes in URL to prevent JS injection
                safe_url = action.url.replace("'", "\\'")
                await shell.evaluate(f"window.electron.browser.navigate('{safe_url}')")
                # Wait for the page to actually load before returning.
                # The IPC navigate fires loadURL and returns immediately;
                # without this pause, subsequent click/type actions race the load.
                await asyncio.sleep(3)
                return {
                    "status": "success",
                    "content": [{"text": f"Navigated to {action.url} via App API"}],
                    "__ui_data__": {
                        "type": "browser",
                        "data": {
                            "url": action.url,
                            "title": action.url,
                            "isLive": True
                        }
                    }
                }
            except Exception as e:
                logger.error(f"Navigation via Shell API failed: {e}")
                return {"status": "error", "content": [{"text": f"Navigation failed: {e}"}]}
        
        # DO NOT fall back to page.goto() - that would destroy the shell!
        logger.error("Shell page not found - cannot navigate safely")
        return {"status": "error", "content": [{"text": "Cannot navigate: Shell page not found. Ensure the Electron app is running."}]}

    async def _async_new_tab(self, action: NewTabAction) -> Dict[str, Any]:
        """Override: Use Shell API to create a new tab."""
        shell = await self._get_shell_page()
        if shell:
            logger.info("Using Shell API to create new tab")
            try:
                await shell.evaluate("window.electron.tabs.create()")
                return {"status": "success", "content": [{"text": "Created new tab via App API"}]}
            except Exception as e:
                return {"status": "error", "content": [{"text": f"Failed to create tab: {e}"}]}
        return {"status": "error", "content": [{"text": "Cannot create tab: Shell page not found"}]}

    async def _async_switch_tab(self, action: SwitchTabAction) -> Dict[str, Any]:
        """Override: Use Shell API to switch tabs."""
        shell = await self._get_shell_page()
        if shell:
            try:
                await shell.evaluate(f"window.electron.tabs.switch('{action.tab_id}')")
                return {"status": "success", "content": [{"text": f"Switched to tab {action.tab_id} via App API"}]}
            except Exception as e:
                return {"status": "error", "content": [{"text": f"Failed to switch tab: {e}"}]}
        return {"status": "error", "content": [{"text": "Cannot switch tab: Shell page not found"}]}

    async def _async_close_tab(self, action: CloseTabAction) -> Dict[str, Any]:
        """Override: Use Shell API to close tabs."""
        shell = await self._get_shell_page()
        if shell:
            try:
                tab_id = action.tab_id or "active"
                await shell.evaluate(f"window.electron.tabs.close('{tab_id}')")
                return {"status": "success", "content": [{"text": f"Closed tab via App API"}]}
            except Exception as e:
                return {"status": "error", "content": [{"text": f"Failed to close tab: {e}"}]}
        return {"status": "error", "content": [{"text": "Cannot close tab: Shell page not found"}]}

    # Simplified overrides for interaction (Click/Type) to target active CONTENT page dynamically
    # CRITICAL: Never fall back to base class for content interactions!

    async def _async_get_text(self, action: GetTextAction) -> Dict[str, Any]:
        """Override: Use Shell IPC to get text from the active tab's content."""
        shell = await self._get_shell_page()
        if not shell:
            return {"status": "error", "content": [{"text": "Cannot getText: Shell page not found."}]}

        try:
            import json
            # Build a JS expression that queries the selector and returns its text
            selector_json = json.dumps(action.selector)
            js_code = json.dumps(
                f"(() => {{ const el = document.querySelector({selector_json}); "
                f"return el ? (el.innerText || el.textContent || '') : null; }})()"
            )
            result = await asyncio.wait_for(
                shell.evaluate(f"window.electron.browser.evaluate({js_code})"),
                timeout=10.0
            )
            if result and result.get("success"):
                text = result.get("result", "")
                return {"status": "success", "content": [{"text": f"Text content: {text}"}]}
            else:
                # Fallback: try getting all page text
                result = await asyncio.wait_for(
                    shell.evaluate("window.electron.browser.getText()"),
                    timeout=10.0
                )
                if result and result.get("success"):
                    return {"status": "success", "content": [{"text": f"Text content: {result.get('text', '')}"}]}
                error = result.get("error", "Unknown error") if result else "No result"
                return {"status": "error", "content": [{"text": f"getText failed: {error}"}]}
        except Exception as e:
            return {"status": "error", "content": [{"text": f"getText failed: {str(e)}"}]}

    async def _async_get_html(self, action: GetHtmlAction) -> Dict[str, Any]:
        """Override: Use Shell IPC to get HTML from the active tab's content."""
        shell = await self._get_shell_page()
        if not shell:
            return {"status": "error", "content": [{"text": "Cannot getHTML: Shell page not found."}]}

        try:
            result = await asyncio.wait_for(
                shell.evaluate("window.electron.browser.getHTML()"),
                timeout=10.0
            )
            if result and result.get("success"):
                html = result.get("html", "")
                return {"status": "success", "content": [{"text": f"HTML content: {html}"}]}
            else:
                error = result.get("error", "Unknown error") if result else "No result"
                return {"status": "error", "content": [{"text": f"getHTML failed: {error}"}]}
        except Exception as e:
            return {"status": "error", "content": [{"text": f"getHTML failed: {str(e)}"}]}

    async def _async_click(self, action: ClickAction) -> Dict[str, Any]:
        """Override: Use Shell IPC to click on the active tab's content."""
        shell = await self._get_shell_page()
        if not shell:
            return {"status": "error", "content": [{"text": "Cannot click: Shell page not found. Ensure the Electron app is running."}]}

        try:
            safe_selector = action.selector.replace("\\", "\\\\").replace("'", "\\'")
            result = await asyncio.wait_for(
                shell.evaluate(f"window.electron.browser.click('{safe_selector}')"),
                timeout=10.0
            )
            if result and result.get("success"):
                return {"status": "success", "content": [{"text": f"Clicked {action.selector} on active tab via IPC"}]}
            else:
                error = result.get("error", "Unknown error") if result else "No result"
                return {"status": "error", "content": [{"text": f"Click failed: {error}"}]}
        except Exception as e:
            return {"status": "error", "content": [{"text": f"Click failed: {str(e)}"}]}

    async def _async_type(self, action: TypeAction) -> Dict[str, Any]:
        """Override: Use Shell IPC to type into the active tab's content."""
        shell = await self._get_shell_page()
        if not shell:
            return {"status": "error", "content": [{"text": "Cannot type: Shell page not found. Ensure the Electron app is running."}]}

        try:
            safe_selector = action.selector.replace("\\", "\\\\").replace("'", "\\'")
            safe_text = action.text.replace("\\", "\\\\").replace("'", "\\'")
            result = await asyncio.wait_for(
                shell.evaluate(f"window.electron.browser.type('{safe_selector}', '{safe_text}')"),
                timeout=10.0
            )
            if result and result.get("success"):
                return {"status": "success", "content": [{"text": f"Typed text into {action.selector} via IPC"}]}
            else:
                error = result.get("error", "Unknown error") if result else "No result"
                return {"status": "error", "content": [{"text": f"Type failed: {error}"}]}
        except Exception as e:
            return {"status": "error", "content": [{"text": f"Type failed: {str(e)}"}]}

    async def _async_evaluate(self, action: EvaluateAction) -> Dict[str, Any]:
        """Override: Route evaluate through Shell IPC.
        
        Scripts referencing window.electron run on the shell page directly.
        All other scripts run on the active tab's content via browser:evaluate IPC.
        """
        shell = await self._get_shell_page()
        if not shell:
            return {"status": "error", "content": [{"text": "Cannot evaluate: Shell page not found."}]}
        
        timeout_s = float(os.getenv("STRANDS_EVALUATE_TIMEOUT", "8"))

        # Scripts that explicitly use window.electron should run on the shell page
        if "window.electron" in action.script:
            try:
                result = await asyncio.wait_for(shell.evaluate(action.script), timeout=timeout_s)
                return {"status": "success", "content": [{"text": f"Evaluation result: {result}"}]}
            except asyncio.TimeoutError:
                return {"status": "error", "content": [{"text": f"Evaluate timed out after {timeout_s}s"}]}
            except Exception as e:
                return {"status": "error", "content": [{"text": f"Evaluate failed: {str(e)}"}]}

        # All other scripts run on the active tab content via IPC
        try:
            # Use JSON to safely pass the script string
            import json
            safe_script = json.dumps(action.script)
            result = await asyncio.wait_for(
                shell.evaluate(f"window.electron.browser.evaluate({safe_script})"),
                timeout=timeout_s
            )
            if result and result.get("success"):
                return {"status": "success", "content": [{"text": f"Evaluation result: {result.get('result')}"}]}
            else:
                error = result.get("error", "Unknown error") if result else "No result"
                return {"status": "error", "content": [{"text": f"Evaluate failed: {error}"}]}
        except asyncio.TimeoutError:
            return {"status": "error", "content": [{"text": f"Evaluate timed out after {timeout_s}s"}]}
        except Exception as e:
            return {"status": "error", "content": [{"text": f"Evaluate failed: {str(e)}"}]}

    async def _async_screenshot(self, action: ScreenshotAction) -> Dict[str, Any]:
        """Take screenshot of active tab content via Shell IPC (webContents.capturePage).
        
        The Electron side returns a resized JPEG at 60% quality to keep payloads small.
        """
        shell = await self._get_shell_page()
        if not shell:
            return {"status": "error", "content": [{"text": "Cannot screenshot: Shell page not found."}]}

        try:
            result = await asyncio.wait_for(
                shell.evaluate("window.electron.browser.screenshot()"),
                timeout=15.0
            )
            if not result or not result.get("success"):
                error = result.get("error", "Unknown error") if result else "No result"
                return {"status": "error", "content": [{"text": f"Screenshot failed: {error}"}]}

            import base64
            screenshot_bytes = base64.b64decode(result["data"])
            fmt = result.get("format", "jpeg")

            config = load_screenshot_config()
            processed_bytes, info = compress_image_bytes(
                screenshot_bytes,
                config,
                jpeg_quality=config.jpeg_quality,
            )
            cache_path = cache_image_bytes(processed_bytes, config, prefix="browser")

            # Save to file if requested
            if action.path:
                save_dir = os.path.dirname(action.path) if os.path.isabs(action.path) else os.getenv("STRANDS_BROWSER_SCREENSHOTS_DIR", "screenshots")
                if not os.path.isabs(action.path):
                    save_dir = os.getenv("STRANDS_BROWSER_SCREENSHOTS_DIR", "screenshots")
                    os.makedirs(save_dir, exist_ok=True)
                    path = os.path.join(save_dir, action.path)
                else:
                    path = action.path
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                if not path.lower().endswith((".jpg", ".jpeg", ".png")):
                    path = f"{os.path.splitext(path)[0]}.jpg"
                with open(path, "wb") as f:
                    f.write(processed_bytes)

            content = []
            if info["fits"]:
                image_block = {"image": {"format": fmt, "source": {"bytes": processed_bytes}}}
                if cache_path:
                    image_block["cache_path"] = cache_path
                content.append(image_block)
            else:
                note = (
                    "Screenshot cached but omitted from context "
                    f"({round(info['bytes'] / 1024, 1)} KB > {round(config.max_bytes / 1024, 1)} KB)"
                )
                if cache_path:
                    note = f"{note}. Cache: {cache_path}"
                content.append({"text": note})

            content.append({"text": f"Screenshot ({round(info['bytes'] / 1024, 1)} KB, {fmt})"})
            return {"status": "success", "content": content}
        except Exception as e:
            logger.error(f"Screenshot failed: {e}")
            return {"status": "error", "content": [{"text": f"Screenshot failed: {str(e)}"}]}
