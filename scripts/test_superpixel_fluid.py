import io
import os
import boto3
import cv2
import numpy as np
from PIL import Image
from skimage.segmentation import slic

def test_pipeline():
    s3 = boto3.client(
        's3', 
        endpoint_url=f"http://{os.getenv('MINIO_URL', 'minio:9000')}", 
        aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID', 'admin'), 
        aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY', 'password123')
    )

    images_to_test = ['2022_01-06/img_0001.jpg', '2022_01-06/img_0002.jpg', '2022_01-06/img_0003.jpg']
    success_count = 0
    total_count = 0

    for img_key in images_to_test:
        res = s3.get_object(Bucket='images', Key=img_key)
        img = Image.open(io.BytesIO(res['Body'].read())).convert('RGB')
        img_np = np.array(img)
        h_img, w_img = img_np.shape[:2]
        
        lbl_key = 'labels/' + img_key.replace('/', '_').replace('.jpg', '.txt')
        lbl_res = s3.get_object(Bucket='images', Key=lbl_key)
        lines = [ln.strip() for ln in lbl_res['Body'].read().decode('utf-8').strip().split('\n') if ln.strip()]
        
        for line in lines[:5]:
            total_count += 1
            parts = line.split()
            cls, xc, yc, w, h = [float(x) for x in parts]
            bx1 = (xc - w/2) * w_img
            by1 = (yc - h/2) * h_img
            bx2 = (xc + w/2) * w_img
            by2 = (yc + h/2) * h_img
            
            bw = bx2 - bx1
            bh = by2 - by1
            pad = max(3, int(min(bw, bh) * 0.15))
            x1 = max(0, int(bx1 - pad))
            y1 = max(0, int(by1 - pad))
            x2 = min(w_img, int(bx2 + pad))
            y2 = min(h_img, int(by2 + pad))
            
            crop = img_np[y1:y2, x1:x2]
            ch, cw = crop.shape[:2]
            if ch < 8 or cw < 8:
                continue
                
            crop_lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(np.float32)
            n_seg = int(np.clip((ch * cw) / 40.0, 20, 80))
            segments = slic(crop, n_segments=n_seg, compactness=14.0, sigma=0.8, start_label=0, channel_axis=-1)
            num_seg = int(np.max(segments)) + 1
            
            # Adjacency
            adj = {i: set() for i in range(num_seg)}
            dh = segments[:, :-1] != segments[:, 1:]
            dv = segments[:-1, :] != segments[1:, :]
            for u, v in zip(segments[:, :-1][dh], segments[:, 1:][dh]):
                adj[u].add(v); adj[v].add(u)
            for u, v in zip(segments[:-1, :][dv], segments[1:, :][dv]):
                adj[u].add(v); adj[v].add(u)
                
            mean_lab = {}
            centers = {}
            for s in range(num_seg):
                mask_s = (segments == s)
                if np.any(mask_s):
                    mean_lab[s] = np.mean(crop_lab[mask_s], axis=0)
                    coords = np.argwhere(mask_s)
                    centers[s] = (np.mean(coords[:, 1]), np.mean(coords[:, 0]))
                else:
                    mean_lab[s] = np.zeros(3, dtype=np.float32)
                    centers[s] = (0, 0)
                    
            # Seed
            seed_x = int(np.clip((bx1 + bx2)/2.0 - x1, 0, cw - 1))
            seed_y = int(np.clip((by1 + by2)/2.0 - y1, 0, ch - 1))
            seed_label = int(segments[seed_y, seed_x])
            seed_color = mean_lab[seed_label]
            
            # Fluid fill
            visited = set([seed_label])
            queue = [seed_label]
            target_hint = bw * bh
            
            lbx1 = bx1 - x1; lby1 = by1 - y1
            lbx2 = bx2 - x1; lby2 = by2 - y1
            pad_env = max(4.0, min(bw, bh) * 0.20)
            
            while queue:
                curr = queue.pop(0)
                for nbr in adj[curr]:
                    if nbr not in visited:
                        cx, cy = centers[nbr]
                        if not (lbx1 - pad_env <= cx <= lbx2 + pad_env and lby1 - pad_env <= cy <= lby2 + pad_env):
                            continue
                        d_seed = np.linalg.norm(mean_lab[nbr] - seed_color)
                        d_local = np.linalg.norm(mean_lab[nbr] - mean_lab[curr])
                        if d_seed <= 35.0 or (d_local <= 22.0 and d_seed <= 48.0):
                            visited.add(nbr)
                            queue.append(nbr)
                            
            mask = np.isin(segments, list(visited)).astype(np.uint8) * 255
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            mask_closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
            
            cnts, _ = cv2.findContours(mask_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if cnts:
                main_cnt = max(cnts, key=cv2.contourArea)
                ca = cv2.contourArea(main_cnt)
                ratio = ca / target_hint if target_hint > 0 else 0
                if 0.20 <= ratio <= 1.35:
                    hull = cv2.convexHull(main_cnt)
                    ha = cv2.contourArea(hull)
                    sol = ca / ha if ha > 0 else 0
                    if sol >= 0.40:
                        peri = cv2.arcLength(main_cnt, True)
                        approx = cv2.approxPolyDP(main_cnt, max(1.2, 0.016 * peri), True)
                        pts = approx.reshape(-1, 2)
                        success_count += 1
                        print(f"Building {total_count:02d} ({img_key}): SUCCESS! Vertices={len(pts)}, AreaRatio={ratio:.2f}, Solidity={sol:.2f}")
                        continue
            print(f"Building {total_count:02d} ({img_key}): Fallback triggered (AreaRatio or Shape out of bounds)")

    print(f"\n==========================================")
    print(f"Total Tested: {total_count}")
    print(f"Superpixel + Fluid Field Success: {success_count}/{total_count} ({success_count/total_count*100:.1f}%)")
    print(f"==========================================")

if __name__ == '__main__':
    test_pipeline()
