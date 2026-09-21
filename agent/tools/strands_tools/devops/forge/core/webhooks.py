"""Webhook Scaffolding - Signature verification and subscription management."""

import hashlib
import hmac
import json
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class WebhookSubscription:
    """Represents a webhook subscription."""
    id: str
    url: str
    event_types: list[str]
    secret: str
    created_at: float
    active: bool = True
    max_retries: int = 3
    retry_delay: float = 1.0  # Initial delay in seconds (exponential backoff)


class WebhookStore:
    """SQLite-backed webhook subscription store."""
    
    def __init__(self, db_path: str | None = None):
        if db_path is None:
            db_path = os.path.join(os.getcwd(), "data", "forge_webhooks.db")
        
        self.db_path = db_path
        self._local = threading.local()
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_db()
    
    def _get_conn(self) -> sqlite3.Connection:
        """Get thread-local connection."""
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(self.db_path)
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn
    
    def _init_db(self) -> None:
        """Initialize database tables."""
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS subscriptions (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                event_types TEXT NOT NULL,
                secret TEXT NOT NULL,
                created_at REAL NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                max_retries INTEGER NOT NULL DEFAULT 3,
                retry_delay REAL NOT NULL DEFAULT 1.0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscription_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at REAL NOT NULL,
                last_attempt_at REAL,
                error_message TEXT,
                FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_deliveries_pending 
            ON deliveries(subscription_id, status) 
            WHERE status = 'pending'
        """)
        conn.commit()
    
    def create_subscription(
        self,
        subscription_id: str,
        url: str,
        event_types: list[str],
        secret: str,
        max_retries: int = 3,
        retry_delay: float = 1.0
    ) -> WebhookSubscription:
        """Create a new subscription."""
        conn = self._get_conn()
        created_at = time.time()
        
        conn.execute(
            """INSERT INTO subscriptions 
               (id, url, event_types, secret, created_at, active, max_retries, retry_delay)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (subscription_id, url, json.dumps(event_types), secret, created_at, 1, max_retries, retry_delay)
        )
        conn.commit()
        
        return WebhookSubscription(
            id=subscription_id,
            url=url,
            event_types=event_types,
            secret=secret,
            created_at=created_at,
            active=True,
            max_retries=max_retries,
            retry_delay=retry_delay
        )
    
    def get_subscription(self, subscription_id: str) -> WebhookSubscription | None:
        """Get a subscription by ID."""
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM subscriptions WHERE id = ?",
            (subscription_id,)
        ).fetchone()
        
        if row is None:
            return None
        
        return WebhookSubscription(
            id=row["id"],
            url=row["url"],
            event_types=json.loads(row["event_types"]),
            secret=row["secret"],
            created_at=row["created_at"],
            active=bool(row["active"]),
            max_retries=row["max_retries"],
            retry_delay=row["retry_delay"]
        )
    
    def list_subscriptions(
        self,
        active_only: bool = True,
        event_type: str | None = None
    ) -> list[WebhookSubscription]:
        """List subscriptions with optional filters."""
        conn = self._get_conn()
        
        query = "SELECT * FROM subscriptions WHERE 1=1"
        params: list[Any] = []
        
        if active_only:
            query += " AND active = 1"
        
        rows = conn.execute(query, params).fetchall()
        
        subscriptions = []
        for row in rows:
            sub = WebhookSubscription(
                id=row["id"],
                url=row["url"],
                event_types=json.loads(row["event_types"]),
                secret=row["secret"],
                created_at=row["created_at"],
                active=bool(row["active"]),
                max_retries=row["max_retries"],
                retry_delay=row["retry_delay"]
            )
            
            # Filter by event type if specified
            if event_type and event_type not in sub.event_types:
                continue
            
            subscriptions.append(sub)
        
        return subscriptions
    
    def delete_subscription(self, subscription_id: str) -> bool:
        """Delete a subscription."""
        conn = self._get_conn()
        cursor = conn.execute(
            "DELETE FROM subscriptions WHERE id = ?",
            (subscription_id,)
        )
        conn.commit()
        return cursor.rowcount > 0
    
    def deactivate_subscription(self, subscription_id: str) -> bool:
        """Deactivate a subscription."""
        conn = self._get_conn()
        cursor = conn.execute(
            "UPDATE subscriptions SET active = 0 WHERE id = ?",
            (subscription_id,)
        )
        conn.commit()
        return cursor.rowcount > 0
    
    def enqueue_delivery(
        self,
        subscription_id: str,
        event_type: str,
        payload: dict[str, Any]
    ) -> int:
        """Enqueue a webhook delivery. Returns delivery ID."""
        conn = self._get_conn()
        created_at = time.time()
        
        cursor = conn.execute(
            """INSERT INTO deliveries 
               (subscription_id, event_type, payload, created_at)
               VALUES (?, ?, ?, ?)""",
            (subscription_id, event_type, json.dumps(payload), created_at)
        )
        conn.commit()
        return cursor.lastrowid
    
    def get_pending_deliveries(
        self,
        limit: int = 100,
        now: float | None = None,
    ) -> list[dict[str, Any]]:
        """Get retry-eligible pending deliveries for processing."""
        conn = self._get_conn()
        now = now if now is not None else time.time()
        rows = conn.execute(
            """SELECT d.*, s.url, s.secret, s.max_retries, s.retry_delay
               FROM deliveries d
               JOIN subscriptions s ON d.subscription_id = s.id
               WHERE d.status = 'pending'
               AND s.active = 1
               ORDER BY d.created_at""",
        ).fetchall()
        
        deliveries = []
        for row in rows:
            attempt_count = row["attempt_count"]
            last_attempt_at = row["last_attempt_at"]
            retry_delay = float(row["retry_delay"])
            due_delay = _next_retry_delay_seconds(retry_delay, attempt_count)

            if last_attempt_at is not None:
                elapsed = now - float(last_attempt_at)
                if elapsed < due_delay:
                    continue

            deliveries.append({
                "id": row["id"],
                "subscription_id": row["subscription_id"],
                "url": row["url"],
                "event_type": row["event_type"],
                "payload": json.loads(row["payload"]),
                "attempt_count": attempt_count,
                "secret": row["secret"],
                "max_retries": row["max_retries"],
                "retry_delay": retry_delay,
            })
            if len(deliveries) >= limit:
                break
        
        return deliveries
    
    def update_delivery_status(
        self,
        delivery_id: int,
        status: str,
        error_message: str | None = None
    ) -> None:
        """Update delivery status."""
        conn = self._get_conn()
        now = time.time()
        
        conn.execute(
            """UPDATE deliveries 
               SET status = ?, error_message = ?, last_attempt_at = ?, attempt_count = attempt_count + 1
               WHERE id = ?""",
            (status, error_message, now, delivery_id)
        )
        conn.commit()

    def get_delivery(self, delivery_id: int) -> dict[str, Any] | None:
        """Get a delivery record by ID for diagnostics/testing."""
        conn = self._get_conn()
        row = conn.execute(
            """SELECT id, subscription_id, event_type, payload, attempt_count, status, created_at, last_attempt_at, error_message
               FROM deliveries
               WHERE id = ?""",
            (delivery_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "subscription_id": row["subscription_id"],
            "event_type": row["event_type"],
            "payload": json.loads(row["payload"]),
            "attempt_count": row["attempt_count"],
            "status": row["status"],
            "created_at": row["created_at"],
            "last_attempt_at": row["last_attempt_at"],
            "error_message": row["error_message"],
        }


class WebhookSigner:
    """HMAC signature verification for webhooks."""
    
    DEFAULT_TIMESTAMP_HEADER = "X-Webhook-Timestamp"
    DEFAULT_SIGNATURE_HEADER = "X-Webhook-Signature"
    
    def __init__(
        self,
        secret: str,
        timestamp_header: str = DEFAULT_TIMESTAMP_HEADER,
        signature_header: str = DEFAULT_SIGNATURE_HEADER,
        max_age_seconds: float = 300.0  # 5 minutes
    ):
        self.secret = secret.encode("utf-8")
        self.timestamp_header = timestamp_header
        self.signature_header = signature_header
        self.max_age_seconds = max_age_seconds
    
    def sign_payload(
        self,
        payload: bytes | str,
        timestamp: float | None = None
    ) -> dict[str, str]:
        """Sign a payload and return headers."""
        if timestamp is None:
            timestamp = time.time()
        
        timestamp_str = str(int(timestamp))
        
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        
        # Build signed content: timestamp.body
        signed_content = timestamp_str.encode("utf-8") + b"." + payload
        
        # Generate HMAC-SHA256 signature
        signature = hmac.new(
            self.secret,
            signed_content,
            hashlib.sha256
        ).hexdigest()
        
        return {
            self.timestamp_header: timestamp_str,
            self.signature_header: f"sha256={signature}"
        }
    
    def verify_signature(
        self,
        payload: bytes | str,
        headers: dict[str, str]
    ) -> dict[str, Any]:
        """
        Verify webhook signature with timestamp anti-replay.
        
        Returns:
            {"valid": bool, "error": str | None}
        """
        timestamp_str = headers.get(self.timestamp_header)
        signature = headers.get(self.signature_header)
        
        if not timestamp_str:
            return {"valid": False, "error": "Missing timestamp header"}
        
        if not signature:
            return {"valid": False, "error": "Missing signature header"}
        
        # Verify timestamp (anti-replay)
        try:
            timestamp = int(timestamp_str)
            now = int(time.time())
            age = abs(now - timestamp)
            
            if age > self.max_age_seconds:
                return {
                    "valid": False,
                    "error": f"Timestamp too old ({age}s > {self.max_age_seconds}s)"
                }
        except ValueError:
            return {"valid": False, "error": "Invalid timestamp format"}
        
        # Verify signature
        expected_headers = self.sign_payload(payload, timestamp)
        expected_signature = expected_headers[self.signature_header]
        
        # Constant-time comparison
        if not hmac.compare_digest(signature, expected_signature):
            return {"valid": False, "error": "Signature mismatch"}
        
        return {"valid": True, "error": None}


def create_webhook_headers(
    secret: str,
    payload: dict[str, Any]
) -> dict[str, str]:
    """
    Create webhook headers with signature.
    
    Args:
        secret: Webhook secret
        payload: Payload to sign
        
    Returns:
        Headers dict with timestamp and signature
    """
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signer = WebhookSigner(secret)
    return signer.sign_payload(payload_bytes)


def verify_webhook_signature(
    secret: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    max_age_seconds: float = 300.0
) -> dict[str, Any]:
    """
    Verify a webhook signature.
    
    Args:
        secret: Webhook secret
        payload: Received payload
        headers: Received headers
        max_age_seconds: Maximum age for timestamp validation
        
    Returns:
        {"valid": bool, "error": str | None}
    """
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signer = WebhookSigner(secret, max_age_seconds=max_age_seconds)
    return signer.verify_signature(payload_bytes, headers)


class DeliveryWorker:
    """Delivery worker with retry/backoff logic."""
    
    def __init__(
        self,
        store: WebhookStore,
        poll_interval_seconds: float = 1.0,
        request_timeout_seconds: float = 10.0,
        http_client: httpx.Client | None = None,
    ):
        self.store = store
        self.poll_interval_seconds = poll_interval_seconds
        self.request_timeout_seconds = request_timeout_seconds
        self._running = False
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._http_client = http_client
        self._owns_http_client = http_client is None

    def _client(self) -> httpx.Client:
        if self._http_client is None:
            self._http_client = httpx.Client(
                timeout=self.request_timeout_seconds,
                follow_redirects=False,
            )
        return self._http_client
    
    def process_pending(self, batch_size: int = 100) -> dict[str, int]:
        """
        Process pending deliveries.
        
        Returns:
            Stats about processed deliveries
        """
        deliveries = self.store.get_pending_deliveries(limit=batch_size)
        
        stats = {"processed": 0, "succeeded": 0, "failed": 0, "retried": 0}
        
        for delivery in deliveries:
            stats["processed"] += 1
            
            # Check if max retries exceeded
            if delivery["attempt_count"] >= delivery["max_retries"]:
                self.store.update_delivery_status(
                    delivery["id"],
                    "failed",
                    "Max retries exceeded"
                )
                stats["failed"] += 1
                continue

            ok, error = self._deliver_once(delivery)
            if ok:
                self.store.update_delivery_status(delivery["id"], "delivered", None)
                stats["succeeded"] += 1
                continue

            next_attempt_count = delivery["attempt_count"] + 1
            if next_attempt_count >= delivery["max_retries"]:
                self.store.update_delivery_status(delivery["id"], "failed", error)
                stats["failed"] += 1
            else:
                self.store.update_delivery_status(delivery["id"], "pending", error)
                stats["retried"] += 1
        
        return stats

    def _deliver_once(self, delivery: dict[str, Any]) -> tuple[bool, str | None]:
        """Send one webhook delivery attempt."""
        payload_bytes = json.dumps(
            delivery["payload"],
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        signature_headers = create_webhook_headers(delivery["secret"], delivery["payload"])
        headers = {
            **signature_headers,
            "Content-Type": "application/json",
            "User-Agent": "API-Forge-WebhookWorker/1.0",
            "X-Webhook-Event": str(delivery["event_type"]),
            "X-Webhook-Delivery": str(delivery["id"]),
        }

        try:
            response = self._client().post(
                str(delivery["url"]),
                content=payload_bytes,
                headers=headers,
                timeout=self.request_timeout_seconds,
            )
        except Exception as exc:
            return False, f"Request error: {exc}"

        if 200 <= response.status_code < 300:
            return True, None

        body_preview = response.text[:300] if response.text else ""
        if body_preview:
            return False, f"HTTP {response.status_code}: {body_preview}"
        return False, f"HTTP {response.status_code}"

    def _run_loop(self) -> None:
        while self._running:
            try:
                self.process_pending()
            except Exception:
                # Keep worker alive on unexpected processing errors.
                pass
            time.sleep(self.poll_interval_seconds)
    
    def start_background(self, poll_interval_seconds: float | None = None) -> None:
        """Start background processing loop."""
        with self._lock:
            if self._running:
                return
            if poll_interval_seconds is not None:
                self.poll_interval_seconds = poll_interval_seconds
            self._running = True
            self._thread = threading.Thread(
                target=self._run_loop,
                name="forge-webhook-delivery-worker",
                daemon=True,
            )
            self._thread.start()
    
    def stop(self) -> None:
        """Stop background processing."""
        with self._lock:
            self._running = False
            thread = self._thread
            self._thread = None
        if thread is not None:
            thread.join(timeout=2.0)
        if self._owns_http_client and self._http_client is not None:
            self._http_client.close()
            self._http_client = None


def _next_retry_delay_seconds(retry_delay: float, attempt_count: int) -> float:
    """
    Compute retry delay for the *next* attempt based on attempts already made.

    attempt_count == 0 means first attempt is immediate.
    """
    if attempt_count <= 0:
        return 0.0
    return float(retry_delay) * (2 ** (attempt_count - 1))


# Global store instance
_default_store: WebhookStore | None = None


def get_webhook_store(db_path: str | None = None) -> WebhookStore:
    """Get or create the default webhook store."""
    global _default_store
    if _default_store is None:
        _default_store = WebhookStore(db_path)
    return _default_store
