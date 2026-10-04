"""
GeoPrice AI - Classical Computer Vision Contour Extractor
Extracts sharp architectural roof vector polygons and calculates exact net area (sq.m.)
at the user's clicked location using Bilateral Filtering, Independent Otsu/Adaptive Thresholding, 
Morphology, and Polygon Simplification (approxPolyDP).
Supports optional bounding box guidance from YOLO object detection.
"""

import math
from typing import Dict, Any, List, Tuple, Optional
import cv2
import numpy as np


def extract_target_roof_polygon(
    image_bgr: np.ndarray,
    click_x: float,
    click_y: float,
    m_per_px: float,
    roi_radius_px: int = 90,
    bounding_box: Optional[Tuple[float, float, float, float]] = None
) -> Dict[str, Any]:
    """
    Extracts the roof polygon of the building at (click_x, click_y).
    
    :param image_bgr: Full stitched satellite image as BGR numpy array
    :param click_x: Target click X in image pixel coordinates
    :param click_y: Target click Y in image pixel coordinates
    :param m_per_px: Resolution scale (meters per pixel)
    :param roi_radius_px: Half-width of cropped ROI around click (when unguided)
    :param bounding_box: Optional (xmin, ymin, xmax, ymax) from YOLO detection or HITL
    :return: Dict containing polygon vertices, area_sqm, width_m, length_m, confidence
    """
    img_h, img_w = image_bgr.shape[:2]
    
    # 1. Bounds checking and adaptive crop ROI
    if bounding_box is not None:
        bx1, by1, bx2, by2 = bounding_box
        bw = max(10, bx2 - bx1)
        bh = max(10, by2 - by1)
        pad = max(16, int(0.25 * max(bw, bh)))
        x1 = max(0, int(bx1 - pad))
        y1 = max(0, int(by1 - pad))
        x2 = min(img_w, int(bx2 + pad))
        y2 = min(img_h, int(by2 + pad))
        target_area_hint = float(bw * bh)
    else:
        x1 = max(0, int(click_x - roi_radius_px))
        y1 = max(0, int(click_y - roi_radius_px))
        x2 = min(img_w, int(click_x + roi_radius_px))
        y2 = min(img_h, int(click_y + roi_radius_px))
        target_area_hint = (14.0 / m_per_px) ** 2  # ~200 sqm default hint

    roi = image_bgr[y1:y2, x1:x2]
    crop_h, crop_w = roi.shape[:2]
    if roi.size == 0 or crop_h < 10 or crop_w < 10:
        return _fallback_box_polygon(click_x, click_y, m_per_px, bounding_box)
        
    local_target_x = float(click_x - x1)
    local_target_y = float(click_y - y1)
    
    # 2. Color Conversion & Edge-Preserving Preprocessing
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    
    # Bilateral filter preserves sharp roof edges while suppressing ground/grass noise
    filtered = cv2.bilateralFilter(gray, d=7, sigmaColor=45, sigmaSpace=45)
    
    # 3. Independent candidate segmentation masks
    # Both standard and inverted masks are generated to detect bright roofs (tile/metal) and dark roofs (shingles/shadow)
    _, otsu_thresh = cv2.threshold(filtered, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, otsu_inv_thresh = cv2.threshold(filtered, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    adaptive_thresh = cv2.adaptiveThreshold(
        filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 25, 4
    )
    adaptive_inv_thresh = cv2.adaptiveThreshold(
        filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 25, 4
    )
    
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    candidates = []
    
    mask_candidates = [
        ("otsu", otsu_thresh),
        ("otsu_inv", otsu_inv_thresh),
        ("adapt", adaptive_thresh),
        ("adapt_inv", adaptive_inv_thresh),
    ]
    
    # 4. Extract & Score Contours Across All Candidate Masks
    for mask_name, mask_img in mask_candidates:
        closed = cv2.morphologyEx(mask_img, cv2.MORPH_CLOSE, kernel, iterations=2)
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for cnt in contours:
            area = cv2.contourArea(cnt)
            rx, ry, rw, rh = cv2.boundingRect(cnt)
            
            # Discard contours that flood the entire ROI boundary
            if rw >= crop_w - 2 and rh >= crop_h - 2:
                continue
                
            # Area filter
            if bounding_box is not None:
                if area < 0.12 * target_area_hint or area > 1.45 * target_area_hint:
                    continue
            else:
                min_area_px = (5.0 / m_per_px) ** 2   # At least 25 sq.m.
                max_area_px = (85.0 / m_per_px) ** 2  # At most 7,225 sq.m.
                if area < min_area_px or area > max_area_px:
                    continue
                    
            pts = cnt.reshape(-1, 2).astype(np.float32)
            inside = (cv2.pointPolygonTest(pts, (local_target_x, local_target_y), False) >= 0)
            
            M = cv2.moments(cnt)
            if M["m00"] != 0:
                cx = M["m10"] / M["m00"]
                cy = M["m01"] / M["m00"]
            else:
                cx, cy = rx + rw / 2.0, ry + rh / 2.0
                
            dist = math.hypot(cx - local_target_x, cy - local_target_y)
            
            hull = cv2.convexHull(cnt)
            hull_area = cv2.contourArea(hull)
            solidity = float(area) / float(hull_area) if hull_area > 0 else 0.0
            
            # Scoring: strong priority for direct hit, distance to click, and geometric compactness
            score = (250.0 if inside else 0.0) - (dist * 1.8) + (solidity * 60.0)
            candidates.append((score, area, cnt, mask_name, inside, dist))
            
    # 5. Select Best Contour and Simplify to Vector Polygon
    if candidates:
        candidates.sort(key=lambda c: c[0], reverse=True)
        best_score, best_area, best_contour, best_mask, direct_hit, min_dist = candidates[0]
        
        # Simplify with approxPolyDP for crisp architectural corners
        perimeter = cv2.arcLength(best_contour, True)
        epsilon = max(1.8, 0.02 * perimeter)
        approx = cv2.approxPolyDP(best_contour, epsilon=epsilon, closed=True)
        pts_clean = approx.reshape(-1, 2)
        
        # Ensure at least 4 vertices for architectural realism
        if len(pts_clean) < 4:
            hull = cv2.convexHull(best_contour)
            approx_hull = cv2.approxPolyDP(hull, max(1.5, 0.025 * cv2.arcLength(hull, True)), closed=True)
            pts_clean = approx_hull.reshape(-1, 2)
            if len(pts_clean) < 4:
                rect = cv2.minAreaRect(best_contour)
                pts_clean = cv2.boxPoints(rect).astype(np.int32)
            
        # Shift back from local ROI to image pixel coordinates (explicit float32 for OpenCV 5.0)
        global_pts = np.asarray(pts_clean + np.array([x1, y1]), dtype=np.float32)

        # Calculate geometric metrics
        px_area = cv2.contourArea(global_pts)
        area_sqm = round(float(px_area * (m_per_px ** 2)), 1)

        rect = cv2.minAreaRect(global_pts)
        w_px, h_px = rect[1]
        width_m = round(min(w_px, h_px) * m_per_px, 1)
        length_m = round(max(w_px, h_px) * m_per_px, 1)
        
        center_x = float(rect[0][0])
        center_y = float(rect[0][1])
        
        return {
            "found": True,
            "method": f"opencv_{best_mask}",
            "points": global_pts.tolist(),
            "area_sqm": max(25.0, area_sqm),
            "area_wah": round(max(25.0, area_sqm) / 4.0, 1),
            "width_m": max(3.0, width_m),
            "length_m": max(4.0, length_m),
            "center": [center_x, center_y],
            "confidence": 0.92 if direct_hit else 0.78,
            "vertices_count": len(global_pts)
        }
        
    return _fallback_box_polygon(click_x, click_y, m_per_px, bounding_box)


def _fallback_box_polygon(
    click_x: float, 
    click_y: float, 
    m_per_px: float,
    bounding_box: Optional[Tuple[float, float, float, float]] = None
) -> Dict[str, Any]:
    """
    Fallback polygon:
    - If YOLO bounding box is provided, returns the 4 corners of that detected building footprint.
    - Otherwise returns a standard centered footprint.
    """
    if bounding_box is not None:
        bx1, by1, bx2, by2 = bounding_box
        pts = [
            [float(bx1), float(by1)],
            [float(bx2), float(by1)],
            [float(bx2), float(by2)],
            [float(bx1), float(by2)],
        ]
        w_m = round((bx2 - bx1) * m_per_px, 1)
        l_m = round((by2 - by1) * m_per_px, 1)
        area_sqm = round(w_m * l_m, 1)
        return {
            "found": True,
            "method": "yolo_bbox_rect",
            "points": pts,
            "area_sqm": max(25.0, area_sqm),
            "area_wah": round(max(25.0, area_sqm) / 4.0, 1),
            "width_m": min(w_m, l_m),
            "length_m": max(w_m, l_m),
            "center": [(bx1 + bx2) / 2.0, (by1 + by2) / 2.0],
            "confidence": 0.85,
            "vertices_count": 4
        }

    half_side_m = 6.32  # ~160 sq.m. (12.6m x 12.6m)
    half_side_px = half_side_m / m_per_px
    pts = [
        [click_x - half_side_px, click_y - half_side_px],
        [click_x + half_side_px, click_y - half_side_px],
        [click_x + half_side_px, click_y + half_side_px],
        [click_x - half_side_px, click_y + half_side_px],
    ]
    
    return {
        "found": False,
        "method": "envelope_fallback",
        "points": pts,
        "area_sqm": 160.0,
        "area_wah": 40.0,
        "width_m": 12.6,
        "length_m": 12.6,
        "center": [click_x, click_y],
        "confidence": 0.50,
        "vertices_count": 4
    }
