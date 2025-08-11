import cv2
import numpy as np
import math

def draw_axis(img, yaw, pitch, roll, tdx=None, tdy=None, size=50):
    """
    Draw 3D coordinate axis on image for head pose visualization
    
    Args:
        img: OpenCV image
        yaw: Yaw angle in degrees
        pitch: Pitch angle in degrees  
        roll: Roll angle in degrees
        tdx: X coordinate of face center (nose point)
        tdy: Y coordinate of face center (nose point)
        size: Size of the axis lines
    """
    
    # Convert angles from degrees to radians
    pitch = pitch * np.pi / 180
    yaw = -(yaw * np.pi / 180)
    roll = roll * np.pi / 180

    if tdx != None and tdy != None:
        # Calculate rotation matrix
        # X-axis pointing to right. drawn in red
        x1 = size * (np.cos(yaw) * np.cos(roll)) + tdx
        y1 = size * (np.cos(pitch) * np.sin(roll) + np.cos(roll) * np.sin(pitch) * np.sin(yaw)) + tdy

        # Y-axis pointing down. drawn in green
        x2 = size * (-np.cos(yaw) * np.sin(roll)) + tdx
        y2 = size * (np.cos(pitch) * np.cos(roll) - np.sin(pitch) * np.sin(yaw) * np.sin(roll)) + tdy

        # Z-axis pointing out of the screen. drawn in blue
        x3 = size * (np.sin(yaw)) + tdx
        y3 = size * (-np.cos(yaw) * np.sin(pitch)) + tdy

        # Draw the axis lines
        cv2.line(img, (int(tdx), int(tdy)), (int(x1), int(y1)), (0, 0, 255), 3)    # Red for X-axis
        cv2.line(img, (int(tdx), int(tdy)), (int(x2), int(y2)), (0, 255, 0), 3)    # Green for Y-axis  
        cv2.line(img, (int(tdx), int(tdy)), (int(x3), int(y3)), (255, 0, 0), 3)    # Blue for Z-axis

    return img

def draw_pose_info(img, yaw, pitch, roll, x, y, w, h):
    """
    Draw pose information text on the image
    
    Args:
        img: OpenCV image
        yaw, pitch, roll: Pose angles in degrees
        x, y, w, h: Face bounding box coordinates
    """
    
    # Draw pose angles
    cv2.putText(img, f"Yaw: {yaw:.2f}", (x, y-60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    cv2.putText(img, f"Pitch: {pitch:.2f}", (x, y-40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    cv2.putText(img, f"Roll: {roll:.2f}", (x, y-20), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    
    # Draw focus status
    if abs(yaw) < 20 and abs(pitch) < 10:
        cv2.putText(img, "Focused", (x, y + h + 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 3)
        cv2.rectangle(img, (x, y), (x+w, y+h), (0, 255, 0), 2)  # Green bounding box
    else:
        cv2.putText(img, "Not Focused!", (x, y + h + 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 3)
        cv2.rectangle(img, (x, y), (x+w, y+h), (0, 0, 255), 3)  # Red bounding box
    
    return img
