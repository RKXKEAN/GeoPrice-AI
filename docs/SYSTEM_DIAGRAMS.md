# GeoPrice AI - System Architecture & Workflow Diagrams

เอกสารนี้รวบรวมไดอะแกรมของระบบ **GeoPrice AI** ทั้งหมดในรูปแบบ **Mermaid Diagram** เพื่อให้สามารถนำไปเรนเดอร์ใน GitHub, Notion, Mermaid Live Editor หรือเครื่องมือ Markdown Viewer ได้ทันที

---

## 1. ภาพรวมสถาปัตยกรรมระบบทั้งหมด (System & Infrastructure Architecture)

แสดงโครงสร้างความสัมพันธ์ระหว่าง Frontend, Backend Gateway, Message Queue, AI Worker, MLOps Stack และบริการภายนอก

```mermaid
graph TB
    %% Client Tier
    subgraph ClientTier ["🖥️ Frontend Layer (React 19 + TypeScript + Vite)"]
        UI["Web Interface (Tailwind CSS v4)"]
        MapComp["MapComponent (Leaflet + Turf.js)"]
        DrawTool["โหมดวาดแปลงที่ดิน (Draw Tool)<br/>- คำนวณ ตร.ม. สดจากรูปวาด 100%<br/>- ผูกป้ายขนาดบนแผนที่"]
        RadarView["โหมด AI Radar View<br/>- อาคารเป้าหมาย: Polygon<br/>- อาคารรอบข้าง 200 ม.: Bounding Box"]
        ZonePricing["Client-side Zone Pricing Lookup<br/>(<1ms กรมธนารักษ์ระดับถนน/ตำบล)"]
        AdminUI["Admin MLOps Dashboard<br/>(/admin)"]
    end

    %% API Gateway Tier
    subgraph GatewayTier ["⚡ Backend Gateway Layer (FastAPI)"]
        API["REST API Router (/api/v1)"]
        PredictEndpoint["/predictions/ (ส่งงานประเมิน)"]
        WSEndpoint["WebSocket (/ws/{job_id})"]
        AdminEndpoint["/admin/ (Auth & MLOps API)"]
    end

    %% Data & Queue Tier
    subgraph QueueDataTier ["💾 Data & Queue Layer"]
        Redis["Redis 7<br/>- ARQ Job Queue<br/>- WebSocket Pub/Sub Broker"]
        Postgres["PostgreSQL 15<br/>- ตารางแปลงที่ดิน (Parcels)<br/>- ข้อมูลประเมินย้อนหลัง<br/>- บัญชีผู้ดูแลระบบ"]
        MinIO["MinIO S3 Object Storage<br/>- ภาพถ่ายดาวเทียมความละเอียดสูง<br/>- ไฟล์โมเดล (.pt / .pkl / .onnx)"]
    end

    %% AI & MLOps Tier
    subgraph AITier ["🧠 AI Worker & MLOps Pipeline"]
        Worker["ARQ Background Worker (worker.py)"]
        YOLO["YOLOv8 Segmentation (best.pt)<br/>- ตรวจจับสิ่งปลูกสร้าง<br/>- รอยเท้าอาคาร 200 ม."]
        MLEnsemble["ML Valuation Ensemble<br/>- XGBoost / LightGBM / CatBoost<br/>- SHAP Explainability Engine"]
        MLflow["MLflow Tracking & Registry (Port 5000)"]
        LabelStudio["Label Studio (Port 8080)<br/>- Human-in-the-Loop Annotation"]
    end

    %% External Services
    subgraph ExternalTier ["🌐 External GIS & Satellite Services"]
        ESRIWayback["ESRI World Imagery Wayback (ArcGIS)<br/>(ภาพถ่ายดาวเทียมความละเอียดสูง 10 รอบเวลา Zoom 17)"]
        GoogleSat["Google Satellite Tiles (Raw & Hybrid)<br/>(แผนที่ฐานสดและการสแกน AI Radar)"]
        OSRM["OSRM Public/Local API<br/>(คำนวณระยะถนนจริง <= 500 ม.)"]
        Overpass["Overpass API<br/>(ค้นหา POIs ในรัศมี 1,000 ม.)"]
    end

    %% Connections
    UI --> MapComp
    MapComp --> DrawTool
    MapComp --> RadarView
    DrawTool --> ZonePricing
    UI --> AdminUI

    MapComp --> GoogleSat
    MapComp --> OSRM
    MapComp --> Overpass
    ESRIWayback --> Worker

    UI --> PredictEndpoint
    UI <--> WSEndpoint
    AdminUI --> AdminEndpoint

    API --> PredictEndpoint
    API --> AdminEndpoint
    PredictEndpoint --> Postgres
    PredictEndpoint --> Redis
    WSEndpoint <--> Redis

    Redis --> Worker
    Worker --> YOLO
    Worker --> MLEnsemble
    Worker --> Postgres
    Worker --> MinIO

    Worker --> MLflow
    MLflow --> MinIO
    AdminEndpoint --> MLflow
    AdminEndpoint --> LabelStudio
    LabelStudio --> MinIO
```

---

## 2. โฟลว์การทำงาน 2 โหมดหลัก (Dual-Mode Interactive Workflow)

แสดงความแตกต่างระหว่าง **โหมดวาดแปลงที่ดิน (Draw Mode)** ที่นับ ตร.ม. จากการวาดจริง กับ **โหมดเลือก AI Radar (Select Mode)** ที่ใช้โมเดล Vision

```mermaid
flowchart TD
    Start(["ผู้ใช้งานเข้าสู่ระบบ GeoPrice AI"]) --> ModeChoice{"เลือกโหมดการทำงานบนหน้าเว็บ"}

    %% ---------------- DRAW MODE ----------------
    subgraph ModeDraw ["✏️ 1. โหมดวาดแปลงที่ดิน (Draw Mode) - [Default]"]
        D1["ผู้ใช้วาดรูปแปลงบนแผนที่ดาวเทียม<br/>(เลือกวาดหลายเหลี่ยม Polygon หรือ สี่เหลี่ยม Rectangle)"]
        D2["Leaflet Draw บันทึกพิกัดจุดยอด (Vertices) ทั้งหมด"]
        D3["คำนวณพื้นที่รูปทรงด้วย Turf.js (turf.area)<br/>⚡ ได้ขนาด ตร.ม. และ ไร่-งาน-ตร.ว. จากรูปวาด 100%"]
        D4["ปักป้าย Tooltip สดตรงกลางแปลง:<br/>📐 ขนาด ตร.ม. + หน่วยไทย + ราคาต่อ ตร.ว."]
        D5["ดึงราคาประเมินฐานทันที (<1ms) ผ่าน zonePricing.ts<br/>(ถนนเสน่หานุสรณ์, กาญจนวณิชย์, คอหงส์ ฯลฯ)"]
        D6["Sidebar คำนวณมูลค่าทันที:<br/>มูลค่า = (พื้นที่ ตร.ม. / 4) × ราคาต่อ ตร.ว."]
        D7{"ต้องการดูสิ่งปลูกสร้างรอบแปลง 200 ม. หรือไม่?"}
        D7_Yes["กดปุ่ม '🛰️ สแกนเรดาร์สิ่งปลูกสร้างรอบแปลง 200 ม.'"]
        D7_No["ข้ามไปยังการประเมินราคาขั้นสูง"]
        D8["รัน YOLOv8 เฉพาะบริบทอาคารรอบข้าง<br/>📦 แสดงผลเป็น Bounding Box (สีฟ้า)"]
        D9["⚠️ ล็อคขนาดแปลงที่ดินเดิมไว้ 100% ไม่ให้โมเดลมาทับ"]
        D10["กดปุ่ม 'ประเมินราคาอัจฉริยะ (ML Ensemble)'"]
    end

    %% ---------------- SELECT MODE ----------------
    subgraph ModeSelect ["🎯 2. โหมดเลือก AI Radar (Select Mode)"]
        S1["ผู้ใช้คลิกเลือกบนหลังคาอาคารที่ต้องการตรวจสอบ"]
        S2["ดึงภาพถ่ายดาวเทียมความละเอียดสูง รัศมี 200 ม."]
        S3["ประมวลผลผ่านโมเดล YOLOv8 Segmentation (best.pt)"]
        S4{"จำแนกผลการตรวจจับ"}
        S4_Target["🎯 อาคารเป้าหมาย (จุดที่คลิก)<br/>👉 แสดงผลรูปทรง Polygon (ขอบตามทรงหลังคาจริง)"]
        S4_Surround["📦 อาคารรอบข้างในระยะ 200 ม.<br/>👉 แสดงผลรูปทรง Bounding Box (กรอบสี่เหลี่ยม 4 มุม)"]
        S5["ค้นหา POIs ในระยะ 500-1000 ม. (Overpass API)<br/>+ วัดระยะถนนจริงด้วย OSRM"]
        S6["แสดงสถิติความหนาแน่น + มิติอาคาร (กว้าง × ยาว)"]
        S7{"ผู้ใช้ต้องการนำรูปทรงอาคารไปใช้เป็นแปลงที่ดิน?"}
        S7_Yes["กดปุ่ม 'ใช้รูปทรงนี้สร้างแปลงที่ดิน'"]
        S7_No["ดูข้อมูลเพื่อวิเคราะห์ศักยภาพทำเล"]
        S8["แปลงขอบเขต Polygon เป็น Drawn Plot<br/>แล้วสลับกลับเข้าสู่โหมดวาด (Draw Mode)"]
    end

    %% Routing
    ModeChoice -->|โหมดวาดแปลงที่ดิน| D1
    ModeChoice -->|โหมด AI Radar| S1

    D1 --> D2 --> D3 --> D4 --> D5 --> D6 --> D7
    D7 -- ใช่ --> D7_Yes --> D8 --> D9 --> D10
    D7 -- ไม่ --> D7_No --> D10

    S1 --> S2 --> S3 --> S4
    S4 --> S4_Target
    S4 --> S4_Surround
    S4_Target & S4_Surround --> S5 --> S6 --> S7
    S7 -- ใช่ --> S7_Yes --> S8 --> D3
    S7 -- ไม่ --> S7_No
```

---

## 3. ซีเควนซ์ไดอะแกรมการประเมินราคาและส่งข้อมูล Real-Time (Sequence Diagram)

แสดงขั้นตอนการส่งคำขอประเมินราคาจากหน้าเว็บ ผ่าน WebSocket และ Worker แบบ Asynchronous

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 ผู้ใช้งาน (Client)
    participant UI as 🖥️ Frontend (React 19)
    participant Map as 🗺️ Leaflet Map / Turf.js
    participant API as ⚡ FastAPI Backend
    participant WS as 🔌 WebSocket Hub (/ws/{job_id})
    participant Redis as 📬 Redis Job Queue
    participant Worker as 🧠 AI Worker (ARQ)
    participant ML as 📊 ML Valuation Ensemble
    participant DB as 🐘 PostgreSQL Database

    User->>Map: วาดแปลงที่ดิน (Polygon หรือ Rectangle)
    Map->>Map: คำนวณพื้นที่จริง turf.area(geoJson)
    Map-->>UI: อัปเดต plotData.areaSqm (ตร.ม. จากการวาดจริง)
    UI-->>User: แสดงป้ายขนาดบนแปลง และราคาประเมินเบื้องต้นใน Sidebar

    User->>UI: คลิกปุ่ม "ประเมินราคาอัจฉริยะ"
    UI->>API: POST /api/v1/predictions/ (geometry, area_size_sqm, zone, POIs)
    API->>DB: บันทึกข้อมูลคำขอ (status: 'pending')
    API->>Redis: Enqueue Prediction Job (job_id)
    API-->>UI: ส่งคืน { job_id: "...", status: "pending" }

    UI->>WS: เชื่อมต่อ WebSocket: /api/v1/predictions/ws/{job_id}
    WS-->>UI: ยืนยันการเชื่อมต่อ (Connected)

    Redis->>Worker: Dispatch งานไปยัง AI Worker
    Worker->>Worker: 1. คำนวณ Spatial Features (ระยะห่างถนน, ศูนย์กลางเมือง, POI)
    Worker->>Worker: 2. เตรียม Matrix ข้อมูลสำหรับ Model Inference
    Worker->>ML: เรียกโมเดล Ensemble (XGBoost + LightGBM + CatBoost)
    ML-->>Worker: คืนค่าราคาทำนาย (บาท/ตร.ว.), Confidence, SHAP Values
    Worker->>DB: อัปเดตผลลัพธ์ลง PostgreSQL (status: 'completed')
    Worker->>Redis: Publish Event 'completed' พร้อม Payload ผลลัพธ์

    Redis->>WS: ส่งต่อข้อความไปยัง Channel ของ job_id
    WS-->>UI: สตรีมผลลัพธ์ผ่าน WebSocket Real-Time
    UI-->>User: แสดงผลราคาประเมินรวม, กราฟแนวโน้ม, ปัจจัยบวก-ลบ (SHAP)
```

---

## 4. สถาปัตยกรรม MLOps & Continuous Learning Loop (Automated + Auto-Labeling + HITL)

แสดงกระบวนการเรียนรู้และปรับปรุงโมเดลอย่างต่อเนื่องแบบ **Automated Pipeline** ครอบคลุมทั้ง **โมเดลตรวจจับอาคาร (Vision Model)** และ **โมเดลทำนายราคาที่ดิน (Price Prediction Model)** พร้อมระบบคัดกรองระหว่าง **Auto-Labeling (โมเดลช่วย Label)** และ **Human-in-the-Loop (ผู้เชี่ยวชาญตรวจสอบ)**

```mermaid
flowchart LR
    %% Stage 1: Ingestion & Trigger
    subgraph S1 ["1. ข้อมูล & Trigger อัตโนมัติ"]
        direction TB
        D1["🛰️ ภาพดาวเทียม ESRI / Google<br/>📜 ราคาประเมินกรมธนารักษ์<br/>💬 ฟีดแบ็กจากผู้ใช้งาน"]
        T1{{"⚡ Auto Trigger<br/>(Cron 6 เดือน / Drift Alert)"}}
        D1 --> T1
    end

    %% Stage 2: Smart Labeling
    subgraph S2 ["2. Label & ตรวจสอบคุณภาพ"]
        direction TB
        AL["🤖 AI Auto-Labeling<br/>(ร่าง Polygon / สกัด Features)"]
        Triage{"มั่นใจ > 85% ?"}
        HITL["🧑‍💻 Human-in-the-Loop<br/>(Label Studio แก้เคสยาก)"]
        Gold[("📁 Gold Dataset")]
        
        AL --> Triage
        Triage -->|ใช่| Gold
        Triage -->|ไม่ใช่ / มีฟีดแบ็ก| HITL
        HITL --> Gold
    end

    %% Stage 3: Retrain Both Models
    subgraph S3 ["3. Retrain อัตโนมัติ & ประเมินผล"]
        direction TB
        M_Vis["👁️ โมเดล Vision (YOLOv8)<br/>จับอาคาร Polygon + BBox 200m"]
        M_Prc["💰 โมเดลราคา (ML Ensemble)<br/>ทำนายราคาที่ดิน บาท/ตร.ว."]
        Gate{"🛡️ Quality Gate<br/>แม่นยำขึ้น?"}
        
        M_Vis & M_Prc --> Gate
    end

    %% Stage 4: Registry & Deploy
    subgraph S4 ["4. จัดเก็บ & Deploy สด"]
        direction TB
        Reg["📦 MLflow + MinIO S3<br/>(คุม Version & เก็บ Weights)"]
        Prod["🚀 AI Worker (Production)<br/>- Vision: best.pt<br/>- Price: ensemble.pkl"]
        Users["👥 ผู้ใช้งานจริง (Web UI)"]
        
        Reg --> Prod --> Users
    end

    %% Pipeline Connections
    T1 --> AL
    Gold --> M_Vis & M_Prc
    Gate -->|✅ ผ่าน| Reg
    Gate -.->|❌ ไม่ผ่าน| HITL
    Users -.->|"Loop ข้อแก้ไขจากผู้ใช้"| D1
```

### คำอธิบายองค์ประกอบสำคัญใน MLOps Loop ฉบับปรับปรุง:

1. **แหล่งภาพถ่ายดาวเทียมความละเอียดสูง (Satellite Imagery Sources)**:
   - **ESRI World Imagery Wayback (ArcGIS Living Atlas)**: แหล่งภาพถ่ายดาวเทียมความละเอียดสูง (Tile Zoom 17) ย้อนหลัง 10 ช่วงเวลาครึ่งปี (2022_01-06 จนถึง 2026_07-12) ดึงผ่านสคริปต์ `scripts/sync_all_wayback_periods.py` จัดเก็บใน MinIO S3 bucket `images/{period}/` สำหรับเทรนและประเมินการเปลี่ยนแปลงของสิ่งปลูกสร้างข้ามกาลเวลา (Spatio-Temporal Analysis)
   - **Google Satellite Tiles (Raw & Hybrid)**: แหล่งภาพถ่ายดาวเทียมความละเอียดสูงสำหรับการเรนเดอร์แผนที่ Interactive Leaflet และการสแกนเรดาร์ AI สดในรัศมี 200 ม.
   - *(หมายเหตุ: ระบบไม่ได้ใช้ Sentinel เนื่องจากภาพถ่ายของ Sentinel มีความละเอียดพิกเซลอยู่ที่ 10–20 เมตร ซึ่งหยาบเกินกว่าจะจำแนกขอบเขตหลังคาอาคารและแปลงที่ดินได้)*
2. **ระบบอัตโนมัติ (Automated Pipeline)**:
   - มี **Automated Triggers** ตรวจสอบรอบเวลา (Scheduled Cron เช่น อัปเดตรอบภาพดาวเทียม ESRI Wayback ทุก 6 เดือน), ปริมาณข้อมูลใหม่ที่สะสม, และการตรวจจับความคลาดเคลื่อน (Drift Detection) เพื่อเริ่มกระบวนการ Retraining โดยอัตโนมัติ
   - มี **Automated Quality Gate** ตรวจสอบคุณภาพโมเดลเทียบกับเกณฑ์และโมเดลรุ่น Production เดิม หากผ่านเกณฑ์จะทำการ Promote สู่ Production อัตโนมัติแบบ Zero-Downtime
3. **การติดป้ายกำกับ (Auto-Labeling + Human-in-the-Loop)**:
   - **Auto-Labeling (AI Pre-annotation)**: ใช้โมเดลปัจจุบันร่าง Polygon อาคารและสกัด Feature ราคาให้อัตโนมัติ ช่วยลดภาระงานคนลงกว่า 70-80%
   - **Confidence Triage**: ข้อมูลที่มั่นใจสูงจะผ่านเข้าชุดข้อมูลโดยตรง ส่วนเคสที่ความมั่นใจต่ำหรือมีข้อท้วงติงจาก User Feedback จะส่งต่อให้ **ผู้เชี่ยวชาญ (Human-in-the-Loop)** ปรับแก้ใน Label Studio
4. **การแยกโมเดลทั้ง 2 ชนิดชัดเจน (Vision Model & Price Prediction Model)**:
   - **โมเดลที่ 1 (Vision Model - YOLOv8 Segmentation `best.pt`)**: รับผิดชอบตรวจจับรอยเท้าอาคาร (Polygon) และบริบทอาคารรอบข้าง 200 ม. (Bounding Box)
   - **โมเดลที่ 2 (Price Prediction Model - ML Valuation Ensemble `ensemble_model.pkl`)**: รับผิดชอบทำนายราคาประเมินที่ดิน (บาท/ตร.ว. และมูลค่ารวม) พร้อมค่า SHAP Values
   - ทั้ง 2 โมเดลถูกจัดเก็บ เวอร์ชันนิ่งใน **MLflow Model Registry** และเก็บบันทึก Artifacts ไว้ใน **MinIO S3** พร้อม Deploy เข้าสู่ AI Worker คู่ขนานกันอย่างเป็นระบบ

