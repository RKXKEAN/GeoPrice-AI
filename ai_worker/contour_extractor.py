"""
GeoPrice AI - Classical Computer Vision Contour Extractor
Extracts sharp architectural roof vector polygons and calculates exact net area (sq.m.)
at the user's clicked location using Bilateral Filtering, Independent Otsu/Adaptive Thresholding, 
Morphology, and Polygon Simplification (approxPolyDP).
Supports optional bounding box guidance from YOLO object detection.
"""

import os
import math
from typing import Dict, Any, List, Tuple, Optional
import cv2
import numpy as np

_fastsam_model = None

def get_fastsam_model():
    """Dynamically load and cache FastSAM foundation model for zero-shot roof segmentation."""
    global _fastsam_model
    if _fastsam_model is None:
        model_path = os.path.join(os.path.dirname(__file__), "FastSAM-s.pt")
        if not os.path.exists(model_path):
            model_path = "FastSAM-s.pt"
        if os.path.exists(model_path):
            try:
                from ultralytics import FastSAM
                _fastsam_model = FastSAM(model_path)
                print(f"🤖 [Contour Extractor] Loaded FastSAM Foundation Model ({model_path})")
            except Exception as e:
                print(f"⚠️ [Contour Extractor] FastSAM init warning: {e}")
    return _fastsam_model


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
    
    # ==========================================================================
    # TIER 1: FastSAM AI Foundation Model (Segment Anything - Sharp Roof Polygon)
    # ==========================================================================
    fastsam_res = _extract_fastsam_polygon(
        roi_bgr=roi,
        local_click_x=local_target_x,
        local_click_y=local_target_y,
        m_per_px=m_per_px,
        x1=x1,
        y1=y1,
        bounding_box=bounding_box,
        target_area_hint=target_area_hint
    )
    if fastsam_res is not None:
        return fastsam_res

    # ==========================================================================
    # TIER 2: SuperPixel (SLIC) + Fluid Field Graph Expansion (Fallback)
    # ==========================================================================
    sp_result = _extract_superpixel_fluid_polygon(
        roi_bgr=roi,
        local_click_x=local_target_x,
        local_click_y=local_target_y,
        m_per_px=m_per_px,
        x1=x1,
        y1=y1,
        bounding_box=bounding_box,
        target_area_hint=target_area_hint
    )
    if sp_result is not None:
        return sp_result

    # ==========================================================================
    # TIER 2: OpenCV Candidate Multi-Thresholding (Bilateral + Otsu/Adaptive Fallback)
    # ==========================================================================
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


def _extract_fastsam_polygon(
    roi_bgr: np.ndarray,
    local_click_x: float,
    local_click_y: float,
    m_per_px: float,
    x1: int,
    y1: int,
    bounding_box: Optional[Tuple[float, float, float, float]],
    target_area_hint: float
) -> Optional[Dict[str, Any]]:
    """
    Tier 1 AI Foundation Model: FastSAM (Segment Anything) Zero-Shot Extractor.
    Extracts sharp architectural roof vector polygons without color leakage or shadow artifacts.
    """
    try:
        model = get_fastsam_model()
        if model is None:
            return None

        h, w = roi_bgr.shape[:2]
        if h < 12 or w < 12:
            return None

        roi_rgb = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2RGB)
        imgsz = 320 if max(h, w) > 256 else 256

        results = model(roi_rgb, device="cpu", imgsz=imgsz, conf=0.20, verbose=False)
        if not results or results[0].masks is None or len(results[0].masks.xy) == 0:
            return None

        # Prepare target BBox prompt mask and ROI coordinates
        bbox_mask = None
        if bounding_box is not None:
            bx1, by1, bx2, by2 = bounding_box
            roi_bx1 = max(0.0, float(bx1 - x1))
            roi_by1 = max(0.0, float(by1 - y1))
            roi_bx2 = min(float(w), float(bx2 - x1))
            roi_by2 = min(float(h), float(by2 - y1))
            box_area = max(10.0, (roi_bx2 - roi_bx1) * (roi_by2 - roi_by1))
            bbox_mask = np.zeros((h, w), dtype=np.uint8)
            cv2.rectangle(bbox_mask, (int(roi_bx1), int(roi_by1)), (int(roi_bx2), int(roi_by2)), 255, -1)
        else:
            box_area = float(w * h)

        candidates = []
        for poly in results[0].masks.xy:
            if len(poly) < 3:
                continue
            rx, ry, rw, rh = cv2.boundingRect(poly.astype(np.int32))
            # Discard masks that flood the entire ROI borders (background segments)
            if rw >= w - 4 and rh >= h - 4:
                continue

            pts = poly.astype(np.float32)
            inside = cv2.pointPolygonTest(pts, (float(local_click_x), float(local_click_y)), False) >= 0
            area = float(cv2.contourArea(pts))
            if area < (3.5 / m_per_px) ** 2:  # at least ~12 sqm
                continue

            m = np.zeros((h, w), dtype=np.uint8)
            cv2.fillPoly(m, [poly.astype(np.int32)], 255)

            if bbox_mask is not None:
                inter = cv2.bitwise_and(m, bbox_mask)
                inter_area = float(np.count_nonzero(inter))
                leak = cv2.bitwise_and(m, cv2.bitwise_not(bbox_mask))
                leak_area = float(np.count_nonzero(leak))

                if inter_area < 0.20 * box_area:
                    continue
                # Reward overlap with YOLO BBox prompt, penalize leaking outside onto road/neighbors
                score = (inter_area / box_area) * 100.0 - (leak_area / box_area) * 45.0 + (35.0 if inside else 0.0)
            else:
                M = cv2.moments(pts)
                if M["m00"] != 0:
                    cx, cy = float(M["m10"] / M["m00"]), float(M["m01"] / M["m00"])
                else:
                    cx, cy = float(np.mean(pts[:, 0])), float(np.mean(pts[:, 1]))
                dist = math.hypot(cx - local_click_x, cy - local_click_y)
                score = (350.0 if inside else 0.0) - dist * 1.5 + np.log(max(1.0, area)) * 8.0

            candidates.append((score, pts, area, inside, m))

        if not candidates:
            return None

        candidates.sort(key=lambda c: c[0], reverse=True)
        best_score, best_pts, best_area, inside, best_mask = candidates[0]

        # Apply clipping constraint if BBox prompt is provided (strictly prevents leaking into roads)
        if bbox_mask is not None:
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            bbox_dilated = cv2.dilate(bbox_mask, kernel, iterations=1)
            constrained_mask = cv2.bitwise_and(best_mask, bbox_dilated)
            cnts, _ = cv2.findContours(constrained_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if cnts:
                best_cnt = max(cnts, key=cv2.contourArea)
                peri = cv2.arcLength(best_cnt, True)
                approx = cv2.approxPolyDP(best_cnt, max(1.2, 0.015 * peri), True)
                pts_clean = approx.reshape(-1, 2).astype(np.float32)
            else:
                pts_clean = cv2.approxPolyDP(best_pts, max(1.2, 0.015 * cv2.arcLength(best_pts, True)), True).reshape(-1, 2).astype(np.float32)
        else:
            # Architectural Vector Simplification
            peri = cv2.arcLength(best_pts, True)
            approx = cv2.approxPolyDP(best_pts, max(1.2, 0.015 * peri), True)
            pts_clean = approx.reshape(-1, 2).astype(np.float32)

        if len(pts_clean) < 4:
            hull = cv2.convexHull(best_pts)
            approx_hull = cv2.approxPolyDP(hull, max(1.2, 0.02 * cv2.arcLength(hull, True)), closed=True)
            pts_clean = approx_hull.reshape(-1, 2).astype(np.float32)
            if len(pts_clean) < 4:
                rect = cv2.minAreaRect(best_pts)
                pts_clean = cv2.boxPoints(rect).astype(np.float32)

        global_pts = pts_clean + np.array([x1, y1], dtype=np.float32)

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
            "method": "fastsam_ai",
            "points": global_pts.tolist(),
            "area_sqm": max(25.0, area_sqm),
            "area_wah": round(max(25.0, area_sqm) / 4.0, 1),
            "width_m": max(3.0, width_m),
            "length_m": max(4.0, length_m),
            "center": [center_x, center_y],
            "confidence": 0.96 if inside else 0.89,
            "vertices_count": len(global_pts)
        }
    except Exception:
        return None


def _extract_superpixel_fluid_polygon(
    roi_bgr: np.ndarray,
    local_click_x: float,
    local_click_y: float,
    m_per_px: float,
    x1: int,
    y1: int,
    bounding_box: Optional[Tuple[float, float, float, float]],
    target_area_hint: float
) -> Optional[Dict[str, Any]]:
    """
    Tier 1 SuperPixel (SLIC) + Fluid Field Graph Expansion Extractor.
    Segments the architectural roof boundary along homogeneous color-texture clusters
    and expands outward from the clicked roof seed superpixel using Lab color Euclidean distance.
    """
    try:
        from skimage.segmentation import slic
    except ImportError:
        return None

    ch, cw = roi_bgr.shape[:2]
    if ch < 12 or cw < 12:
        return None

    try:
        roi_rgb = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2RGB)
        roi_lab = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)

        # 1. SLIC Superpixels (Adaptive cluster count based on ROI area)
        n_seg = int(np.clip((ch * cw) / 45.0, 20, 90))
        segments = slic(roi_rgb, n_segments=n_seg, compactness=14.0, sigma=0.8, start_label=0, channel_axis=-1)
        num_seg = int(np.max(segments)) + 1

        # 2. Build Adjacency Graph
        adj = {i: set() for i in range(num_seg)}
        dh = segments[:, :-1] != segments[:, 1:]
        dv = segments[:-1, :] != segments[1:, :]
        for u, v in zip(segments[:, :-1][dh], segments[:, 1:][dh]):
            adj[u].add(v)
            adj[v].add(u)
        for u, v in zip(segments[:-1, :][dv], segments[1:, :][dv]):
            adj[u].add(v)
            adj[v].add(u)

        # 3. Superpixel mean Lab color and centroid coordinates
        mean_lab = {}
        centers = {}
        for s in range(num_seg):
            mask_s = (segments == s)
            if np.any(mask_s):
                mean_lab[s] = np.mean(roi_lab[mask_s], axis=0)
                coords = np.argwhere(mask_s)
                centers[s] = (float(np.mean(coords[:, 1])), float(np.mean(coords[:, 0])))
            else:
                mean_lab[s] = np.zeros(3, dtype=np.float32)
                centers[s] = (0.0, 0.0)

        # 4. Determine Seed Superpixel:
        # If bounding box is given and click was slightly nearby, center seed on the building
        if bounding_box is not None:
            bx1, by1, bx2, by2 = bounding_box
            lbx1 = bx1 - x1
            lby1 = by1 - y1
            lbx2 = bx2 - x1
            lby2 = by2 - y1
            if lbx1 <= local_click_x <= lbx2 and lby1 <= local_click_y <= lby2:
                seed_x = int(np.clip(local_click_x, 0, cw - 1))
                seed_y = int(np.clip(local_click_y, 0, ch - 1))
            else:
                seed_x = int(np.clip((lbx1 + lbx2) / 2.0, 0, cw - 1))
                seed_y = int(np.clip((lby1 + lby2) / 2.0, 0, ch - 1))
            pad_env = max(4.0, min(bx2 - bx1, by2 - by1) * 0.25)
            min_x, max_x = lbx1 - pad_env, lbx2 + pad_env
            min_y, max_y = lby1 - pad_env, lby2 + pad_env
        else:
            seed_x = int(np.clip(local_click_x, 0, cw - 1))
            seed_y = int(np.clip(local_click_y, 0, ch - 1))
            min_x, max_x = -5.0, float(cw) + 5.0
            min_y, max_y = -5.0, float(ch) + 5.0

        seed_label = int(segments[seed_y, seed_x])
        seed_color = mean_lab[seed_label]

        # 6. Fluid Field Expansion (BFS Graph Walk)
        visited = {seed_label}
        queue = [seed_label]

        while queue:
            curr = queue.pop(0)
            for nbr in adj[curr]:
                if nbr not in visited:
                    cx, cy = centers[nbr]
                    if not (min_x <= cx <= max_x and min_y <= cy <= max_y):
                        continue
                    d_seed = float(np.linalg.norm(mean_lab[nbr] - seed_color))
                    d_local = float(np.linalg.norm(mean_lab[nbr] - mean_lab[curr]))
                    if d_seed <= 38.0 or (d_local <= 24.0 and d_seed <= 52.0):
                        visited.add(nbr)
                        queue.append(nbr)

        # 7. Generate Binary Mask & Morphological Refinement
        mask = np.isin(segments, list(visited)).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        mask_closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

        # 8. Contour Detection & Validation
        cnts, _ = cv2.findContours(mask_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            return None

        # Prioritize contour that contains the click, or largest contour
        best_cnt = None
        for cnt in cnts:
            if cv2.pointPolygonTest(cnt, (float(seed_x), float(seed_y)), False) >= 0:
                best_cnt = cnt
                break
        if best_cnt is None:
            best_cnt = max(cnts, key=cv2.contourArea)

        ca = float(cv2.contourArea(best_cnt))
        if target_area_hint > 0:
            ratio = ca / target_area_hint
            if not (0.12 <= ratio <= 1.95):
                return None
        else:
            min_area_px = (3.5 / m_per_px) ** 2
            if ca < min_area_px:
                return None

        hull = cv2.convexHull(best_cnt)
        ha = float(cv2.contourArea(hull))
        solidity = (ca / ha) if ha > 0 else 0.0
        if solidity < 0.35:
            return None

        # 9. Architectural Polygon Simplification
        peri = cv2.arcLength(best_cnt, True)
        epsilon = max(1.4, 0.016 * peri)
        approx = cv2.approxPolyDP(best_cnt, epsilon=epsilon, closed=True)
        pts_clean = approx.reshape(-1, 2)

        if len(pts_clean) < 4:
            approx_hull = cv2.approxPolyDP(hull, max(1.2, 0.02 * cv2.arcLength(hull, True)), closed=True)
            pts_clean = approx_hull.reshape(-1, 2)
            if len(pts_clean) < 4:
                rect = cv2.minAreaRect(best_cnt)
                pts_clean = cv2.boxPoints(rect).astype(np.int32)

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

        inside = (cv2.pointPolygonTest(global_pts, (float(local_click_x + x1), float(local_click_y + y1)), False) >= 0)

        return {
            "found": True,
            "method": "superpixel_fluid",
            "points": global_pts.tolist(),
            "area_sqm": max(25.0, area_sqm),
            "area_wah": round(max(25.0, area_sqm) / 4.0, 1),
            "width_m": max(3.0, width_m),
            "length_m": max(4.0, length_m),
            "center": [center_x, center_y],
            "confidence": 0.95 if inside else 0.88,
            "vertices_count": len(global_pts)
        }

    except Exception:
        # Graceful fallback to OpenCV Tier 2
        return None


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
