import os
import subprocess
from typing import Any

import boto3
from botocore.config import Config as BotocoreConfig
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
from strands import tool

from strands_tools.utils import console_util


def create_status_table(
    mode: str,
    text: str,
    voice_id: str = None,
    output_path: str = None,
    play_audio: bool = True,
) -> Table:
    """Create a rich table showing speech parameters."""
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Parameter", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Mode", mode)
    table.add_row("Text", text[:50] + "..." if len(text) > 50 else text)
    table.add_row("Play Audio", str(play_audio))
    if mode == "polly":
        table.add_row("Voice ID", voice_id)
        table.add_row("Output Path", output_path)

    return table


def display_speech_status(console: Console, status: str, message: str, style: str):
    """Display a status message in a styled panel."""
    console.print(
        Panel(
            f"[{style}]{message}[/{style}]",
            title=f"[bold {style}]{status}[/bold {style}]",
            border_style=style,
        )
    )


@tool
def speak(
    text: str,
    mode: str = "fast",
    voice_id: str = "Joanna",
    output_path: str = "speech_output.mp3",
    play_audio: bool = True
) -> dict:
    """
    Generate speech from text using either say command (fast mode) on macOS, or Amazon Polly (high quality mode) on other operating systems.

    Set play_audio to false to only generate the audio file instead of also playing.

    Args:
        text: The text to convert to speech
        mode: Speech mode - 'fast' for macOS say command or 'polly' for AWS Polly. Default: 'fast'
        voice_id: The Polly voice ID to use (e.g., Joanna, Matthew) - only used in polly mode. Default: 'Joanna'
        output_path: Path where to save the audio file (only for polly mode). Default: 'speech_output.mp3'
        play_audio: Whether to play the audio through speakers after generation. Default: True

    Returns:
        Dictionary containing status and result message
    """
    speak_default_style = os.getenv("SPEAK_DEFAULT_STYLE", "green")
    console = console_util.create()

    # Use environment variables to override defaults if needed
    if os.getenv("SPEAK_DEFAULT_MODE"):
        mode = os.getenv("SPEAK_DEFAULT_MODE")
    if os.getenv("SPEAK_DEFAULT_VOICE_ID"):
        voice_id = os.getenv("SPEAK_DEFAULT_VOICE_ID")
    if os.getenv("SPEAK_DEFAULT_OUTPUT_PATH"):
        output_path = os.getenv("SPEAK_DEFAULT_OUTPUT_PATH")
    if os.getenv("SPEAK_DEFAULT_PLAY_AUDIO"):
        play_audio = os.getenv("SPEAK_DEFAULT_PLAY_AUDIO", "True").lower() == "true"

    try:
        if mode == "fast":
            # Display status table
            console.print(create_status_table(mode, text, play_audio=play_audio))

            # Show progress while speaking
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                if play_audio:
                    progress.add_task("Speaking...", total=None)
                    # Use macOS say command
                    subprocess.run(["say", text], check=True)
                    result_message = "🗣️ Text spoken using macOS say command"
                else:
                    progress.add_task("Processing...", total=None)
                    # Just process the text without playing
                    result_message = "🗣️ Text processed using macOS say command (audio not played)"

            display_speech_status(console, "Success", result_message, speak_default_style)
            return {
                "status": "success",
                "content": [{"text": result_message}],
            }
        else:  # polly mode
            output_path = os.path.expanduser(output_path)

            # Display status table
            console.print(create_status_table(mode, text, voice_id, output_path, play_audio))

            # Create Polly client
            config = BotocoreConfig(user_agent_extra="strands-agents-speak")
            polly_client = boto3.client("polly", region_name="us-west-2", config=config)

            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                # Add synthesis task
                synthesis_task = progress.add_task("Synthesizing speech...", total=None)

                # Synthesize speech
                response = polly_client.synthesize_speech(
                    Engine="neural", OutputFormat="mp3", Text=text, VoiceId=voice_id
                )

                # Save the audio stream
                if "AudioStream" in response:
                    progress.update(synthesis_task, description="Saving audio file...")
                    with open(output_path, "wb") as file:
                        file.write(response["AudioStream"].read())

                    # Play the generated audio if play_audio is True
                    if play_audio:
                        progress.update(synthesis_task, description="Playing audio...")
                        subprocess.run(["afplay", output_path], check=True)
                        result_message = f"✨ Generated and played speech using Polly (saved to {output_path})"
                    else:
                        result_message = f"✨ Generated speech using Polly (saved to {output_path}, audio not played)"

                    display_speech_status(console, "Success", result_message, speak_default_style)
                    return {
                        "status": "success",
                        "content": [{"text": result_message}],
                    }
                else:
                    display_speech_status(console, "Error", "❌ No AudioStream in response from Polly", "red")
                    return {
                        "status": "error",
                        "content": [{"text": "❌ No AudioStream in response from Polly"}],
                    }

    except Exception as e:
        error_message = f"❌ Error generating speech: {str(e)}"
        display_speech_status(console, "Error", error_message, "red")
        return {
            "status": "error",
            "content": [{"text": error_message}],
        }
