# รายงานความก้าวหน้าโครงการ (Progress Report 3)
## โครงการพัฒนาระบบประเมินราคาที่ดินและสิ่งปลูกสร้างอัจฉริยะ (GeoPrice AI)
**หลักสูตร / รายวิชา:** โครงงานมินิโปรเจกต์ (Mini Project) — ปัญญาประดิษฐ์และระบบสารสนเทศภูมิศาสตร์  
**พื้นที่ศึกษา:** อำเภอหาดใหญ่ จังหวัดสงขลา (ครอบคลุม 21,718 แปลงที่ดิน และภาพถ่ายดาวเทียม 10 รอบเวลา)  
**ประเภทเอกสาร:** Short Report (ความยาวกระชับ 3 หน้า สำหรับส่งตัวแทนกลุ่ม)

---

## 1. การออกแบบการไหลของข้อมูลและสถาปัตยกรรมระบบ (Dataflow & Ecosystem Design)

ระบบ **GeoPrice AI** ถูกออกแบบตามข้อเสนอแนะเชิงวิชาการของอาจารย์ที่ปรึกษา โดยแยกบทบาทของปัญญาประดิษฐ์ โมเดลเชิงปริมาณ และการบริหารจัดการ MLOps ออกจากกันอย่างเป็นอิสระ เพื่อให้เกิดความแม่นยำสูงสุด ลดการสับสนของแบบจำลอง และรองรับการเรียนรู้แบบวงปิด (Closed-Loop Retraining Ecosystem)

```
+---------------------------------------------------------------------------------------------------------+
|                                    GEOPRICE AI DATAFLOW ARCHITECTURE                                    |
+---------------------------------------------------------------------------------------------------------+
  [User Action: Map Click / AOI]
                 |
                 v
  +-----------------------------------------------------------------------------------------------------+
  | FASTAPI BACKEND & ARQ INFERENCE QUEUE (arq:queue_inference)                                         |
  +-----------------------------------------------------------------------------------------------------+
                 |
                 +-----------------------------------+
                 |                                   |
                 v                                   v
  [1. YOLOv8 Object Detection]        [2. OpenCV Classical Contour Extractor]
  - รัศมี 200 เมตร รอบจุดคลิก             - Crop บริเวณรอบหลังคาที่คลิก (ROI Guided)
  - คลาสเดียว: House/Building        - Independent Thresholding (Otsu + Adaptive)
  - ผลลัพธ์: Bounding Box 100%       - Vector Simplification (approxPolyDP)
  - ประโยชน์: นับความหนาแน่นอาคาร         - ผลลัพธ์: เวกเตอร์ Polygon + พื้นที่สุทธิ (ตร.ม.)
                 |                                   |
                 +-----------------+-----------------+
                                   |
                                   v
             [3. Hybrid Spatial Valuation Engine (ML/Econometric)]
             - รวม: พื้นที่สุทธิ (ตร.ม.) + จำนวนอาคารรอบข้าง + ราคาโซนผังเมือง
             - โมเดล: Stacking Ensemble (XGBoost + LightGBM + RF) + ARIMAX
                                   |
                                   v
             [PostgreSQL Database: Multi-State Lifecycle Schema]
             - State 1: บันทึกข้อมูลเริ่มต้นอัตโนมัติ (Initial AI Detection)
             - State 2: บันทึกการตรวจแก้โดย Admin (HITL Verified & Recalculated)
             - State 3: จับคู่ราคาประเมินจริงในอนาคต (Cadastral Ground Truth Evaluation)
```

### 1.1 กระบวนการไหลของข้อมูล 3 ขั้นตอน (3-Step Hybrid Inference Pipeline)
1. **Step 1 — Vision Model (YOLOv8 BBox Detection):** เมื่อผู้ใช้คลิกเลือกตำแหน่งบนแผนที่ ภาพถ่ายดาวเทียมความละเอียดสูง (Tile Zoom 18 ~0.59 ม./พิกเซล) ขนาด 768×768 พิกเซล (~455 ม.) จะถูกส่งเข้าโมเดล YOLOv8 เพื่อตรวจจับอาคารรอบข้างในรัศมี 200 ม. **โดยจำกัดให้ระบุเฉพาะกรอบสี่เหลี่ยม Bounding Box (Class: House/Building)** เพื่อตัดสัญญาณรบกวนและใช้ชี้วัดระดับความหนาแน่น (Urban Density Count)
2. **Step 2 — Classical Computer Vision (OpenCV Contour Extractor):** สำหรับอาคารหลังที่ผู้ใช้เลือก (Target Building) ระบบจะนำพิกัดกรอบอาคารจาก YOLO มาเป็นตัวนำทาง (BBox Guidance) แล้วรันอัลกอริทึมใน `contour_extractor.py` ผ่านกระบวนการ:
   - *Bilateral Filtering:* ขจัดสัญญาณรบกวนจากพื้นดิน/หญ้า โดยคงความคมชัดของสันขอบหลังคา
   - *Multi-Strategy Candidate Thresholding:* ทดสอบหน้ากาก Candidate แยกอิสระ 4 แบบ (`Otsu Normal`, `Otsu Inverted`, `Adaptive Normal`, `Adaptive Inverted`) ป้องกันปัญหาภาพขาวโพลน (Over-segmentation) จากการใช้ `bitwise_or`
   - *Polygon Simplification (`approxPolyDP`):* สกัดเป็นเวกเตอร์ **Polygon** สถาปัตยกรรม ($\ge 4$ จุดยอด) พร้อมคำนวณขนาดพื้นที่หลังคาสุทธิ (Net Roof Area ตารางเมตร) ที่แท้จริง
3. **Step 3 — Valuation Engine (Price Prediction Model):** นำพื้นที่หลังคาสุทธิ ($m^2$) ผสานกับจำนวนความหนาแน่นสิ่งปลูกสร้างรอบข้าง และอัตราผังเมือง ส่งเข้าแบบจำลองการประเมินราคา เพื่อพยากรณ์มูลค่าอสังหาริมทรัพย์

### 1.2 สถาปัตยกรรมระบบนิเวศข้อมูล (Ecosystem & MLOps Architecture)
- **MinIO Object Storage (Dual Data Sources):**
  - *Source 1 (User AOI Triggers):* ภาพถ่ายดาวเทียมและป้ายกำกับ BBox จากการใช้งานจริงของผู้ใช้ (`images/user_triggers/` และ `labels/user_triggers_*.txt`)
  - *Source 2 (6-Month Scheduled Imagery):* ภาพถ่ายดาวเทียมอัตโนมัติรอบครึ่งปี 10 รอบเวลา (`images/{period}/`)
  - *Cadastral Appraisal Datasets:* ชุดข้อมูลราคาประเมินทางการ 21,718 แปลง 10 รอบเวลา (`datasets/appraisal_base_*.csv`)
- **การแยกคิวประมวลผลเด็ดขาด (Worker Isolation via Redis ARQ):**
  - `arq:queue_inference` (Worker Inference): จัดการคำขอผู้ใช้แบบ Real-time, สแกนเรดาร์, สกัด Polygon (Timeout 60s, High Priority)
  - `arq:queue_training` (Worker Trainer): รันงาน Batch Auto-Labeling, Retrain โมเดล Vision (YOLO) และ Retrain โมเดลราคา (Timeout 7200s, Background Heavy)
- **Multi-State Database Schema (`price_predictions`):**
  - **State 1 (Initial State):** บันทึกผลลัพธ์รอบแรกจาก AI (`initial_bboxes`, `initial_polygons`, `initial_price_prediction`, `is_verified=False`)
  - **State 2 (HITL Recalculated State):** บันทึกผลที่ผ่านการตรวจสอบและขยับกรอบ BBox โดย Admin ผ่าน Quick BBox Editor พร้อมคำนวณพื้นที่และราคาใหม่ (`corrected_bboxes`, `recalculated_polygons`, `recalculated_price`, `is_verified=True`)
  - **State 3 (Ground Truth Evaluation State):** บันทึกการเปรียบเทียบกับราคาประเมินจริงของทางราชการในรอบปีถัดไป (`actual_market_price`, `actual_recorded_at`, `error_metrics` เช่น MAPE, MAE)

---

## 2. การออกแบบการทดลองและการวัดผล (Experiment Design)

การทดลองถูกแบ่งออกเป็น 3 การทดลองหลัก ครอบคลุมทั้งฝั่ง Computer Vision, ฝั่ง Price Forecasting Model, และการเรียนรู้แบบวงปิด (Closed-Loop Retraining):

```
+--------------------------------------------------------------------------------------------------------+
|                                      EXPERIMENTAL DESIGN FRAMEWORK                                     |
+--------------------------------------------------------------------------------------------------------+
  [EXPERIMENT 1: VISION & CONTOUR]     [EXPERIMENT 2: VALUATION MODELS]     [EXPERIMENT 3: CLOSED-LOOP]
  - YOLO Detection vs Segmentation     - OLS vs RF vs XGBoost vs Stacking   - Pre-training vs Continuous
  - Multi-Strategy Thresholding        - Time-Series Dynamic + ARIMAX       - User Triggers vs Periodic
  - Metrics: mAP, IoU, Area % MAE      - Metrics: R², MAE, RMSE, MAPE       - Metrics: Retrain mAP, Latency
```

### 2.1 การทดลองที่ 1: การตรวจจับและสกัดรูปทรงอาคาร (Vision & Roof Extraction Experiment)
- **วัตถุประสงค์:** เปรียบเทียบประสิทธิภาพระหว่างการบังคับให้ YOLO ทำ Segmentation โดยตรง กับสถาปัตยกรรมผสม (Hybrid: YOLOv8 BBox + OpenCV Multi-Strategy Contour)
- **ชุดข้อมูลทดสอบ:** ภาพถ่ายดาวเทียมความละเอียดสูงในเขตเทศบาลนครหาดใหญ่และตำบลข้างเคียง จำนวน 1,000 บริเวณ พร้อม Ground Truth Footprints จริง
- **ตัววัดผล (Metrics):**
  - `mAP@50` และ `mAP@50-95` สำหรับความแม่นยำในการระบุตำแหน่งอาคาร (Bounding Box)
  - `Intersection-over-Union (IoU)` ระหว่างรูปทรงเวกเตอร์ Polygon กับรอยเท้าอาคารจริง
  - `Area % MAE` (ความคลาดเคลื่อนร้อยละสัมบูรณ์เฉลี่ยของขนาดพื้นที่สุทธิ $m^2$)
  - `Failure / Fallback Rate` (อัตราการล้มเหลวที่ต้องตกไปใช้กล่องสี่เหลี่ยมขนาดคงที่ 160 ตร.ม.)

| สถาปัตยกรรมแบบจำลอง | mAP@50 (%) | IoU หลังคา (%) | Area % MAE | Failure Rate (%) | ลักษณะรูปทรงที่ได้ |
| :--- | :---: | :---: | :---: | :---: | :--- |
| Baseline A: YOLOv8-Seg (End-to-End) | 71.4% | 63.8% | 22.4% | 0.0% | ขอบหยัก ไม่เป็นมุมฉากสถาปัตยกรรม |
| Baseline B: OpenCV (OR Blending เก่า) | 88.2% (BBox) | 48.1% | 34.6% | **75.0% (หลุด)** | กล่องสี่เหลี่ยมจัตุรัส 160 ตร.ม. (Fallback) |
| **Proposed: 2-Stage Hybrid (YOLO + Multi-Strategy CV)** | **89.6%** | **84.3%** | **5.8%** | **0.0% (สมบูรณ์)** | **Polygon เหลี่ยมสถาปัตยกรรมจริง ($\ge 4$ จุด)** |

*ข้อสรุปการทดลองที่ 1:* การใช้ YOLOv8 ตีกรอบ BBox คลาสเดียว แล้วส่งต่อให้ OpenCV สกัด Polygon ด้วย Candidate Thresholding แยกอิสระ สามารถลดความคลาดเคลื่อนของพื้นที่ ($m^2$) ลงจาก 22.4% เหลือเพียง **5.8%** และลดอัตรา Fallback เหลือ **0%**

---

### 2.2 การทดลองที่ 2: แบบจำลองการประเมินราคาที่ดินและสิ่งปลูกสร้าง (Valuation Models Experiment)
- **วัตถุประสงค์:** พัฒนาและเปรียบเทียบโมเดล Machine Learning และ Econometrics ในการทำนายราคาประเมินและราคาตลาดล่วงหน้า 1–3 ปี
- **ชุดข้อมูลทดลอง:** ข้อมูลแปลงที่ดินและราคาประเมินย้อนหลัง-ปัจจุบัน อำเภอหาดใหญ่ จำนวน 21,718 แปลง ครอบคลุม 10 รอบเวลา (ปี 2022–2026) รวมกว่า 217,000 เรคคอร์ด
- **ตัวแปรนำเข้า (Feature Space):**
  - พิกัดภูมิศาสตร์: ละติจูด, ลองจิจูด, ระยะห่างสู่ศูนย์กลางเมือง (Hat Yai CBD)
  - ปัจจัยเชิงพื้นที่ (Spatial POIs): ระยะทางถนนสู่โรงพยาบาล, โรงเรียน, มหาวิทยาลัย, ห้างสรรพสินค้า, ตลาดสด (คำนวณผ่าน OSRM/Overpass)
  - ปัจจัยผังเมืองและสิ่งแวดล้อม: โซนสีผังเมือง, ความกว้างเขตทางถนน
  - ข้อมูลจาก Vision Hybrid: พื้นที่หลังคาสุทธิ ($m^2$) และจำนวนความหนาแน่นสิ่งปลูกสร้างรอบข้างในรัศมี 200 เมตร
- **ตัววัดผล (Metrics):** ค่าสัมประสิทธิ์การตัดสินใจ ($R^2$), ค่าคลาดเคลื่อนสัมบูรณ์เฉลี่ย (MAE บาท/ตร.ว.), ค่ารากที่สองของความคลาดเคลื่อนกำลังสองเฉลี่ย (RMSE บาท/ตร.ว.), และค่าร้อยละความคลาดเคลื่อนสัมบูรณ์เฉลี่ย (MAPE %)

| แบบจำลองประเมินราคา | $R^2$ Score | MAE (บาท/ตร.ว.) | RMSE (บาท/ตร.ว.) | MAPE (%) | จุดเด่น / พฤติกรรมโมเดล |
| :--- | :---: | :---: | :---: | :---: | :--- |
| 1. Ordinary Least Squares (OLS) | 0.6840 | 6,850 | 11,240 | 18.25% | เส้นฐานเชิงเส้น ไม่สามารถจับ Non-linear ได้ |
| 2. Random Forest Regressor | 0.9120 | 2,780 | 4,690 | 7.84% | ทนทานต่อ Outlier แต่คาดการณ์แนวโน้มเวลาจำกัด |
| 3. LightGBM Regressor | 0.9415 | 2,120 | 3,850 | 5.92% | ทำงานรวดเร็วสูง แยกฟีเจอร์เชิงพื้นที่ได้ดี |
| 4. XGBoost Regressor | 0.9580 | 1,840 | 3,210 | 4.86% | แม่นยำสูง ดึงปฏิสัมพันธ์ระหว่างฟีเจอร์ได้ยอดเยี่ยม |
| **5. Proposed: Stacking Ensemble + ARIMAX** | **0.9750** | **1,420** | **2,480** | **4.12%** | **รวมข้อดี Gradient Boosting และ Time-Series** |

*ข้อสรุปการทดลองที่ 2:* โมเดลผสมแบบ Stacking Ensemble (XGBoost + LightGBM + Random Forest) ร่วมกับแบบจำลองอนุกรมเวลา ARIMAX ทำผลงานได้ดีที่สุด โดยให้ค่า **$R^2 = 0.9750$** และค่า **MAPE ต่ำเพียง 4.12%** โดยปัจจัยความหนาแน่นอาคาร 200 ม. จาก Vision Model ช่วยเพิ่มค่า $R^2$ ขึ้นถึง +0.038

---

### 2.3 การทดลองที่ 3: ระบบการเรียนรู้แบบวงปิดและการปรับปรุงโมเดลต่อเนื่อง (Closed-Loop Retraining Evaluation)
- **วัตถุประสงค์:** ประเมินความเสถียรและความแม่นยำที่เพิ่มขึ้นเมื่อโมเดลผ่านวงจร Retraining โดยผสานข้อมูลจาก 2 แหล่ง (User AOI Interaction BBoxes + MinIO 6-Month Scheduled Imagery)
- **ระเบียบวิธีทดลอง:**
  - รอบ Retrain ที่ 1: เทรนด้วยภาพดาวเทียมรอบครึ่งปี 1,000 ภาพ (Baseline mAP@50 = 85.2%)
  - รอบ Retrain ที่ 2: รวมข้อมูลจริงที่ผู้ใช้คลิกใช้งานและผ่านการตรวจสอบโดย Admin (HITL State 2) เพิ่มอีก 150 ภาพ (Merged = 1,150 ภาพ)
  - ตรวจสอบประสิทธิภาพการลู่เข้า (Convergence) และการประหยัดเวลาด้วยระบบคิวแยกอิสระ

```
+--------------------------------------------------------------------------------------------------------+
|                               CLOSED-LOOP VISION RETRAINING PROGRESSION                                |
+--------------------------------------------------------------------------------------------------------+
  Cycle 0 (Initial Model)      : mAP@50 = 85.20% | Box Loss = 0.412
  Cycle 1 (+150 User AOI BBox) : mAP@50 = 89.60% | Box Loss = 0.245 (+4.40% Accuracy Gain)
  Cycle 2 (+300 User AOI BBox) : mAP@50 = 92.90% | Box Loss = 0.142 (+7.70% Cumulative Gain)
```

- **ผลการประเมินเวลาและทรัพยากร (Resource & Latency Benchmark):**
  - เวลาในการรัน Hybrid Inference (YOLO 200m + OpenCV Polygon + Price Predict): **$< 1.8$ วินาที/คำขอ**
  - เวลาในการ Retrain โมเดล Vision บน NVIDIA GPU (5 Epochs, Batch 16): **$\approx 4.2$ นาที** (ทำงานเบื้องหลังบน `arq:queue_training` ไม่รบกวนหน้าเว็บ)

---

## 3. สรุปผลความก้าวหน้าและแผนงานถัดไป (Milestone Summary & Next Steps)

### ผลการดำเนินงานที่เสร็จสมบูรณ์แล้ว 100%:
1. พัฒนาและเชื่อมต่อสถาปัตยกรรม **2-Stage Hybrid Vision Pipeline** ขจัดปัญหากล่อง 160 ตร.ม. ได้อย่างถาวร
2. ติดตั้งโครงสร้างฐานข้อมูล **Multi-State Lifecycle (State 1, State 2, State 3)** รองรับ MLOps และ HITL อย่างสมบูรณ์
3. ซิงค์ข้อมูลแปลงที่ดินและราคาประเมินจริงของอำเภอหาดใหญ่ **21,718 แปลง ครอบคลุม 10 รอบเวลา**
4. แยกคิวประมวลผลอิสระ `arq:queue_inference` และ `arq:queue_training` พร้อมระบบแจ้งเตือน Admin Notification Center

### แผนงานในระยะถัดไป (Final Submission & Presentation):
- [ ] จัดทำวิดีโอสาธิตการทำงานของระบบ End-to-End ตั้งแต่การคลิกบนแผนที่ การสกัดรูปทรง Polygon ไปจนถึงการตรวจแก้และ Retrain
- [ ] ทดสอบ Stress Testing พร้อมกัน 20 ผู้ใช้ เพื่อตรวจสอบเวลาตอบสนองของระบบคิวบน Redis
- [ ] เตรียมสไลด์นำเสนอฉบับสมบูรณ์สำหรับโครงงานมินิโปรเจกต์
