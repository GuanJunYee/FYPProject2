import cv2 # OpenCV - Computer vision library
import numpy as np  # NumPy - Mathematical operations on arrays
import os
import torch  # PyTorch - Deep learning framework
import torch.nn as nn   # PyTorch - Neural network module
import torch.nn.functional as F # PyTorch - Functional operations for neural networks
import torchvision.transforms as transforms # PyTorch - Image transformations for preprocessing
import torchvision  # PyTorch - Pretrained models and utilities
import math # Math - Mathematical functions
from PIL import Image # Python Imaging Library - Image processing

# Import drawing utilities
try:
    from utils.draw_utils import draw_axis, draw_pose_info
except ImportError:
    print("⚠️ Warning: Could not import drawing utilities")
    def draw_axis(*args, **kwargs):
        pass
    def draw_pose_info(*args, **kwargs):
        pass

# HopeNet Model Architecture (ResNet-50 with Bottleneck blocks)
class Hopenet(nn.Module):
    # Hopenet with 3 output layers for yaw, pitch and roll
    # Predicts Euler angles by binning and regression with the expected value

    def __init__(self, block, layers, num_bins):
        self.inplanes = 64
        super(Hopenet, self).__init__()
        self.conv1 = nn.Conv2d(3, 64, kernel_size=7, stride=2, padding=3, bias=False)
        self.bn1 = nn.BatchNorm2d(64)
        self.relu = nn.ReLU(inplace=True)
        self.maxpool = nn.MaxPool2d(kernel_size=3, stride=2, padding=1)
        self.layer1 = self._make_layer(block, 64, layers[0])
        self.layer2 = self._make_layer(block, 128, layers[1], stride=2)
        self.layer3 = self._make_layer(block, 256, layers[2], stride=2)
        self.layer4 = self._make_layer(block, 512, layers[3], stride=2)
        self.avgpool = nn.AvgPool2d(7)
        self.fc_yaw = nn.Linear(512 * block.expansion, num_bins)
        self.fc_pitch = nn.Linear(512 * block.expansion, num_bins)
        self.fc_roll = nn.Linear(512 * block.expansion, num_bins)

        # Vestigial layer from previous experiments
        self.fc_finetune = nn.Linear(512 * block.expansion + 3, 3)

        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                n = m.kernel_size[0] * m.kernel_size[1] * m.out_channels
                m.weight.data.normal_(0, math.sqrt(2. / n))
            elif isinstance(m, nn.BatchNorm2d):
                m.weight.data.fill_(1)
                m.bias.data.zero_()

    def _make_layer(self, block, planes, blocks, stride=1):
        downsample = None
        if stride != 1 or self.inplanes != planes * block.expansion:
            downsample = nn.Sequential(
                nn.Conv2d(self.inplanes, planes * block.expansion,
                          kernel_size=1, stride=stride, bias=False),
                nn.BatchNorm2d(planes * block.expansion),
            )

        layers = []
        layers.append(block(self.inplanes, planes, stride, downsample))
        self.inplanes = planes * block.expansion
        for i in range(1, blocks):
            layers.append(block(self.inplanes, planes))

        return nn.Sequential(*layers)

    def forward(self, x):
        x = self.conv1(x)
        x = self.bn1(x)
        x = self.relu(x)
        x = self.maxpool(x)

        x = self.layer1(x)
        x = self.layer2(x)
        x = self.layer3(x)
        x = self.layer4(x)

        x = self.avgpool(x)
        x = x.view(x.size(0), -1)
        pre_yaw = self.fc_yaw(x)
        pre_pitch = self.fc_pitch(x)
        pre_roll = self.fc_roll(x)

        return pre_yaw, pre_pitch, pre_roll


class HeadPoseDetector:
    def __init__(self):
        """Initialize HopeNet-based head pose detector"""
        
        # -------------------------------
        # Load face detector for face cropping OpenCV Haar Cascade Face Detector// For ***bounding box*** OpenCV's Haar Cascade face detector
        # -------------------------------
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        if self.face_cascade.empty():
            raise Exception("Could not load face detection model")
        
        # Detection parameters (matching your test code: 1.3, 5)
        self.detection_params = {
            'scaleFactor': 1.3,
            'minNeighbors': 5,
            'minSize': (30, 30)
        }
        
        # Initialize HopeNet model
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"Using device: {self.device}")
        
        # Create HopeNet model (ResNet-50 architecture using torchvision Bottleneck)
        self.model = Hopenet(torchvision.models.resnet.Bottleneck, [3, 4, 6, 3], 66)
        
        # Load the trained model
        model_path = os.path.join('models', 'hopenet_robust_alpha1.pkl')
        if not os.path.exists(model_path):
            raise Exception(f"HopeNet model not found at {model_path}")
        
        print(f"Loading HopeNet model from {model_path}")
        
        # Load model exactly like your test code
        saved_state_dict = torch.load(model_path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(saved_state_dict)
        self.model.to(self.device)
        self.model.eval()  # Set model to evaluation mode (no training behavior)
        
        # Image preprocessing pipeline for HopeNet (matching your test code)
        self.transform = transforms.Compose([
            transforms.Resize(224),  # Resize to 224x224
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        
        # Index tensor for regression (matching your test code)
        self.idx_tensor = torch.FloatTensor([idx for idx in range(66)]).to(self.device)
        
        print("HopeNet Head Pose Detector initialized successfully")

    def detect_head_pose_with_landmarks(self, image):
        """
        Detect head pose using HopeNet deep learning model
        
        Args:
            image: OpenCV image (BGR format)
            
        Returns:
            dict: Contains pose, landmarks, bbox, nose_point or None if no face detected
        """
        try:
            if image is None or image.size == 0:
                print("⚠️ Invalid image provided")
                return None
            
            # Convert to grayscale for face detection
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            
            # Detect faces with multiple attempts for better detection
            faces = self.face_cascade.detectMultiScale(
                gray,
                scaleFactor=self.detection_params['scaleFactor'],
                minNeighbors=self.detection_params['minNeighbors'],
                minSize=self.detection_params['minSize']
            )
            
            # If no faces found with default params, try more lenient detection
            if len(faces) == 0:
                faces = self.face_cascade.detectMultiScale(
                    gray,
                    scaleFactor=1.1,  # More lenient scale factor
                    minNeighbors=3,   # Fewer required neighbors
                    minSize=(20, 20)  # Smaller minimum size
                )
            
            if len(faces) == 0:
                # Try histogram equalization for better contrast
                gray_eq = cv2.equalizeHist(gray)
                faces = self.face_cascade.detectMultiScale(
                    gray_eq,
                    scaleFactor=1.2,
                    minNeighbors=4,
                    minSize=(25, 25)
                )
            
            if len(faces) == 0:
                return None
            
            # Get the largest face
            if len(faces) > 1:
                face_areas = [w * h for (x, y, w, h) in faces]
                largest_face_idx = np.argmax(face_areas)
                x, y, w, h = faces[largest_face_idx]
            else:
                x, y, w, h = faces[0]
            
            # Extract face region directly (matching your test code approach)
            face_img = image[y:y+h, x:x+w]
            
            if face_img.size == 0:
                return None
            
            # Resize face to 224x224 for model input (matching your test code)
            face_img = cv2.resize(face_img, (224, 224))
            
            # Convert BGR to RGB and create PIL Image exactly like your test code
            face_img = Image.fromarray(cv2.cvtColor(face_img, cv2.COLOR_BGR2RGB))
            
            # Preprocess for HopeNet exactly like your test code
            input_tensor = self.transform(face_img).unsqueeze(0).to(self.device)
            
            # Get head pose prediction from HopeNet
            with torch.no_grad():
                yaw_pred, pitch_pred, roll_pred = self.model(input_tensor)
                
                # Convert from classification to regression (matching your test code)
                yaw_predicted = torch.sum(torch.softmax(yaw_pred, dim=1) * self.idx_tensor) * 3 - 99
                pitch_predicted = torch.sum(torch.softmax(pitch_pred, dim=1) * self.idx_tensor) * 3 - 99
                roll_predicted = torch.sum(torch.softmax(roll_pred, dim=1) * self.idx_tensor) * 3 - 99
                
                pose = {
                    'yaw': float(yaw_predicted.item()),
                    'pitch': float(pitch_predicted.item()),
                    'roll': float(roll_predicted.item())
                }
            
            # Create optimized bounding box for display (using original face coordinates)
            face_bbox = {
                'x': x,
                'y': y,
                'width': w,
                'height': h
            }
            
            # Calculate nose point (center of face)
            nose_point = {
                'x': int(x + w // 2),
                'y': int(y + h // 2)
            }
            
            # Generate landmark estimates
            landmarks = self.generate_facial_landmarks(x, y, w, h)
            
            return {
                'pose': pose,
                'landmarks': landmarks,
                'bbox': face_bbox,
                'nose_point': nose_point,
                'confidence': self.calculate_detection_confidence(w, h, image.shape)
            }
            
        except Exception as e:
            return None

    def generate_facial_landmarks(self, x, y, w, h):
        """Generate basic facial landmarks for visualization"""
        landmarks = []
        
        # Left eye
        landmarks.append({
            'x': int(x + w * 0.3),
            'y': int(y + h * 0.35),
            'type': 'left_eye'
        })
        
        # Right eye
        landmarks.append({
            'x': int(x + w * 0.7),
            'y': int(y + h * 0.35),
            'type': 'right_eye'
        })
        
        # Nose
        landmarks.append({
            'x': int(x + w * 0.5),
            'y': int(y + h * 0.55),
            'type': 'nose'
        })
        
        # Mouth
        landmarks.append({
            'x': int(x + w * 0.5),
            'y': int(y + h * 0.75),
            'type': 'mouth'
        })
        
        return landmarks
    
    def calculate_detection_confidence(self, face_width, face_height, image_shape):
        """Calculate detection confidence based on face size relative to image"""
        img_height, img_width = image_shape[:2]
        face_area_ratio = (face_width * face_height) / (img_width * img_height)
        
        # Higher confidence for appropriately sized faces
        if 0.02 <= face_area_ratio <= 0.25:  # 2% to 25% of image
            confidence = min(1.0, face_area_ratio * 10)  # Scale to 0-1
        else:
            confidence = 0.5  # Lower confidence for very small or very large faces
        
        return confidence

    def is_looking_away(self, pose, yaw_threshold=20, pitch_threshold=10):
        """
        Determine if person is looking away based on pose angles
        Using thresholds matching your test code: yaw < 20°, pitch < 10°
        
        Args:
            pose: Dictionary containing yaw, pitch, roll angles
            yaw_threshold: Maximum allowed yaw angle (degrees) - matching test code
            pitch_threshold: Maximum allowed pitch angle (degrees) - matching test code
            
        Returns:
            bool: True if looking away, False if looking forward (focused)
        """
        try:
            if not pose or 'yaw' not in pose or 'pitch' not in pose:
                return True  # Assume looking away if no valid pose
            
            yaw = abs(pose.get('yaw', 0))
            pitch = abs(pose.get('pitch', 0))
            
            is_away = yaw > yaw_threshold or pitch > pitch_threshold
            
            return is_away
            
        except Exception as e:
            print(f"❌ Error checking looking away: {e}")
            return True

    def get_detection_info(self):
        """Get information about the detector"""
        return {
            'detector_type': 'HopeNet Deep Learning (Original Implementation)',
            'face_detection': 'OpenCV haarcascade_frontalface_default.xml',
            'pose_estimation': 'HopeNet ResNet-50 Neural Network with Bottleneck blocks',
            'model_file': 'hopenet_robust_alpha1.pkl',
            'landmark_count': 4,
            'features': ['face_detection', 'neural_pose_estimation', 'landmark_generation', 'confidence_scoring']
        }

# Create global instance
head_pose_detector = HeadPoseDetector()
