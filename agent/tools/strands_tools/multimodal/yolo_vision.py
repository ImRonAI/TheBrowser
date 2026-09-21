"""Background YOLO object detection with continuous monitoring"""

from typing import Dict, Any, List, Optional
import cv2
import threading
import time
import json
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from strands import tool

# Global state for background detection
_detection_thread = None
_detection_active = False
_detection_lock = threading.Lock()
_detections_history = []
_object_counts = defaultdict(int)


def _detection_worker(
    model_name: str, camera_id: int, confidence: float, save_dir: Path, interval: float
):
    """Background worker thread for continuous YOLO detection."""
    global _detection_active

    try:
        # Import YOLO (ultralytics)
        from ultralytics import YOLO

        # Load model
        print(f"🧠 Loading YOLO model: {model_name}")
        model = YOLO(model_name)

        # Open camera
        cam = cv2.VideoCapture(camera_id)
        if not cam.isOpened():
            print(f"❌ Failed to open camera {camera_id}")
            _detection_active = False
            return

        print(f"✅ YOLO detection started on camera {camera_id}")

        while _detection_active:
            start_time = time.time()

            # Capture frame
            ret, frame = cam.read()
            if not ret:
                time.sleep(0.1)
                continue

            # Run YOLO detection
            results = model(frame, conf=confidence, verbose=False)

            # Process detections
            detected_objects = []
            for result in results:
                for box in result.boxes:
                    class_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    class_name = model.names[class_id]

                    detected_objects.append(
                        {
                            "object": class_name,
                            "confidence": round(conf, 3),
                            "bbox": box.xyxy[0].tolist(),
                        }
                    )

                    # Update object counts
                    with _detection_lock:
                        _object_counts[class_name] += 1

            # Log detections if any found
            if detected_objects:
                detection_entry = {
                    "timestamp": datetime.now().isoformat(),
                    "camera_id": camera_id,
                    "objects": detected_objects,
                    "count": len(detected_objects),
                }

                with _detection_lock:
                    _detections_history.append(detection_entry)

                    # Save to file
                    detections_file = save_dir / "detections.jsonl"
                    with open(detections_file, "a") as f:
                        f.write(json.dumps(detection_entry) + "\n")

                # Print detection summary
                objects_summary = ", ".join(
                    [
                        f"{obj['object']}({obj['confidence']:.2f})"
                        for obj in detected_objects
                    ]
                )
                print(
                    f"🔍 [{datetime.now().strftime('%H:%M:%S')}] Detected: {objects_summary}"
                )

            # Maintain interval
            elapsed = time.time() - start_time
            if elapsed < interval:
                time.sleep(interval - elapsed)

        cam.release()
        print("👋 YOLO detection stopped")

    except ImportError:
        print("❌ ultralytics not installed. Run: pip install ultralytics")
        _detection_active = False
    except Exception as e:
        print(f"❌ Detection worker error: {e}")
        _detection_active = False


@tool
def yolo_vision(
    action: str = "status",
    model: str = "yolov8n.pt",
    camera_id: int = 0,
    confidence: float = 0.5,
    save_dir: str = "./.yolo_detections",
    interval: float = 1.0,
    limit: int = 50,
    image_path: Optional[str] = None,
) -> Dict[str, Any]:
    """YOLO object detection for screen analysis and UI element detection.

    Args:
        action: Action to perform
            - "analyze_screen": Capture screen and detect objects with bounding boxes (RECOMMENDED)
            - "analyze_image": Analyze a local image file
            - "start": Begin background camera detection
            - "stop": Stop background detection
            - "status": Check if running
            - "get_detections": Recent detection entries
            - "list_objects": All unique objects seen with counts
            - "clear": Clear detection history
        model: YOLO model to use (yolov8n.pt, yolov8s.pt, yolov8m.pt, etc.)
        camera_id: Camera device ID (for background detection)
        confidence: Minimum confidence threshold (0.0-1.0)
        save_dir: Directory to save detection logs
        interval: Seconds between detections
        limit: Max number of recent detections to return
        image_path: Path to image file for 'analyze_image' action

    Returns:
        Dict with:
        - status: "success" or "error"
        - count: Number of detected objects
        - elements: List of detected objects with bounding boxes:
            - object: Class name (e.g., "person", "button", "text")
            - confidence: Detection confidence (0-1)
            - bbox: [x1, y1, x2, y2] bounding box coordinates
            - x, y: Top-left corner
            - width, height: Element dimensions
            - center: (x, y) tuple for clicking
            - click_x, click_y: Direct click coordinates
    """
    global _detection_thread, _detection_active

    try:
        save_path = Path(save_dir).expanduser()
        save_path.mkdir(parents=True, exist_ok=True)

        if action == "start":
            if _detection_active:
                return {
                    "status": "error",
                    "content": [{"text": "❌ YOLO detection already running"}],
                }

            # Start detection thread
            _detection_active = True
            _detection_thread = threading.Thread(
                target=_detection_worker,
                args=(model, camera_id, confidence, save_path, interval),
                daemon=True,
            )
            _detection_thread.start()

            result_info = [
                "✅ **YOLO Detection Started**",
                f"🧠 Model: {model}",
                f"📹 Camera: {camera_id}",
                f"🎯 Confidence: {confidence}",
                f"⏱️  Interval: {interval}s",
                f"💾 Save dir: `{save_path}`",
            ]

            return {"status": "success", "content": [{"text": "\n".join(result_info)}]}

        elif action == "stop":
            if not _detection_active:
                return {
                    "status": "error",
                    "content": [{"text": "❌ YOLO detection not running"}],
                }

            _detection_active = False
            if _detection_thread:
                _detection_thread.join(timeout=5)

            result_info = [
                "🛑 **YOLO Detection Stopped**",
                f"📊 Total detections logged: {len(_detections_history)}",
                f"🔍 Unique objects seen: {len(_object_counts)}",
            ]

            return {"status": "success", "content": [{"text": "\n".join(result_info)}]}

        elif action == "status":
            with _detection_lock:
                total_detections = len(_detections_history)
                unique_objects = len(_object_counts)
                recent_objects = []

                if _detections_history:
                    last_detection = _detections_history[-1]
                    recent_objects = [
                        obj["object"] for obj in last_detection["objects"]
                    ]

            status_icon = "🟢" if _detection_active else "🔴"
            result_info = [
                f"{status_icon} **YOLO Detection Status**",
                f"Running: {'✅ Yes' if _detection_active else '❌ No'}",
                f"📊 Total detections: {total_detections}",
                f"🔍 Unique objects: {unique_objects}",
                f"💾 Save directory: `{save_path}`",
            ]

            if recent_objects:
                result_info.append(f"🕐 Last seen: {', '.join(set(recent_objects))}")

            return {"status": "success", "content": [{"text": "\n".join(result_info)}]}

        elif action == "get_detections":
            with _detection_lock:
                recent = _detections_history[-limit:] if _detections_history else []

            if not recent:
                return {
                    "status": "success",
                    "content": [{"text": "📭 No detections logged yet"}],
                }

            result_info = [f"🔍 **Recent {len(recent)} Detections:**", ""]

            for entry in recent[-10:]:  # Show last 10
                timestamp = datetime.fromisoformat(entry["timestamp"]).strftime(
                    "%H:%M:%S"
                )
                objects = ", ".join(
                    [
                        f"{obj['object']}({obj['confidence']:.2f})"
                        for obj in entry["objects"]
                    ]
                )
                result_info.append(f"🕐 **{timestamp}**: {objects}")

            result_info.extend(
                [
                    "",
                    f"📊 Total entries: {len(recent)}",
                    f"📁 Full log: `{save_path}/detections.jsonl`",
                ]
            )

            return {"status": "success", "content": [{"text": "\n".join(result_info)}]}

        elif action == "list_objects":
            with _detection_lock:
                object_list = sorted(
                    _object_counts.items(), key=lambda x: x[1], reverse=True
                )

            if not object_list:
                return {
                    "status": "success",
                    "content": [{"text": "📭 No objects detected yet"}],
                }

            result_info = [
                f"🏆 **All Detected Objects ({len(object_list)} unique):**",
                "",
            ]

            for obj, count in object_list:
                result_info.append(f"• **{obj}**: {count} times")

            return {"status": "success", "content": [{"text": "\n".join(result_info)}]}

        elif action == "clear":
            with _detection_lock:
                _detections_history.clear()
                _object_counts.clear()

            # Clear log file
            detections_file = save_path / "detections.jsonl"
            if detections_file.exists():
                detections_file.unlink()

            return {
                "status": "success",
                "content": [{"text": "✅ Detection history cleared"}],
            }

        elif action == "analyze_screen":
            # Capture screen and run YOLO detection
            try:
                from ultralytics import YOLO
            except ImportError:
                return {
                    "status": "error",
                    "content": [{"text": "ultralytics not installed. Run: pip install ultralytics"}],
                }

            try:
                from PIL import ImageGrab
                import numpy as np
            except ImportError:
                return {
                    "status": "error",
                    "content": [{"text": "PIL not installed. Run: pip install pillow"}],
                }

            try:
                # Capture the screen
                screenshot = ImageGrab.grab()
                frame = cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)

                # Load model and run inference
                yolo = YOLO(model)
                results = yolo(frame, conf=confidence, verbose=False)

                # Process results with full bounding box data
                detected_objects = []
                for result in results:
                    for box in result.boxes:
                        class_id = int(box.cls[0])
                        conf_score = float(box.conf[0])
                        class_name = yolo.names[class_id]
                        bbox = box.xyxy[0].tolist()  # [x1, y1, x2, y2]

                        # Calculate center and dimensions
                        x1, y1, x2, y2 = bbox
                        center_x = int((x1 + x2) / 2)
                        center_y = int((y1 + y2) / 2)
                        width = int(x2 - x1)
                        height = int(y2 - y1)

                        detected_objects.append({
                            "object": class_name,
                            "confidence": round(conf_score, 3),
                            "bbox": [int(x1), int(y1), int(x2), int(y2)],
                            "x": int(x1),
                            "y": int(y1),
                            "width": width,
                            "height": height,
                            "center": (center_x, center_y),
                            "click_x": center_x,
                            "click_y": center_y,
                        })

                if not detected_objects:
                    return {
                        "status": "success",
                        "count": 0,
                        "elements": [],
                        "content": [{"text": "No objects detected on screen"}],
                    }

                # Return structured data for programmatic use
                return {
                    "status": "success",
                    "count": len(detected_objects),
                    "elements": detected_objects,
                    "content": [{"text": f"Detected {len(detected_objects)} objects. Use 'elements' for coordinates."}],
                }

            except Exception as e:
                return {
                    "status": "error",
                    "content": [{"text": f"Error capturing/analyzing screen: {str(e)}"}],
                }

        elif action == "analyze_image":
            if not image_path:
                return {
                    "status": "error",
                    "content": [{"text": "image_path argument is required for analyze_image"}],
                }

            try:
                from ultralytics import YOLO
            except ImportError:
                return {
                    "status": "error",
                    "content": [{"text": "ultralytics not installed. Run: pip install ultralytics"}],
                }

            try:
                # Load model and run inference
                yolo = YOLO(model)
                results = yolo(image_path, conf=confidence, verbose=False)

                # Process results with full bounding box data
                detected_objects = []
                for result in results:
                    for box in result.boxes:
                        class_id = int(box.cls[0])
                        conf_score = float(box.conf[0])
                        class_name = yolo.names[class_id]
                        bbox = box.xyxy[0].tolist()

                        x1, y1, x2, y2 = bbox
                        center_x = int((x1 + x2) / 2)
                        center_y = int((y1 + y2) / 2)

                        detected_objects.append({
                            "object": class_name,
                            "confidence": round(conf_score, 3),
                            "bbox": [int(x1), int(y1), int(x2), int(y2)],
                            "x": int(x1),
                            "y": int(y1),
                            "width": int(x2 - x1),
                            "height": int(y2 - y1),
                            "center": (center_x, center_y),
                            "click_x": center_x,
                            "click_y": center_y,
                        })

                if not detected_objects:
                    return {
                        "status": "success",
                        "count": 0,
                        "elements": [],
                        "content": [{"text": f"No objects detected in {image_path}"}],
                    }

                return {
                    "status": "success",
                    "count": len(detected_objects),
                    "elements": detected_objects,
                    "content": [{"text": f"Detected {len(detected_objects)} objects. Use 'elements' for coordinates."}],
                }

            except Exception as e:
                return {
                    "status": "error",
                    "content": [{"text": f"Error processing image: {str(e)}"}],
                }
        
        else:
            return {
                "status": "error",
                "content": [{"text": f"❌ Unknown action: {action}"}],
            }

    except Exception as e:
        return {"status": "error", "content": [{"text": f"❌ Error: {str(e)}"}]}
