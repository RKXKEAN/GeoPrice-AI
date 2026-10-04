/**
 * GeoPrice - Hat Yai Subdistrict & Road Appraisal Reference Database
 * Provides instant (<1ms) baseline valuation lookup based on geographical coordinates (WGS84)
 */

export interface ZonePricingResult {
  subdistrict: string;
  district: string;
  province: string;
  zone_name: string;
  road_name: string;
  price_per_wah: number;
  price_per_sqm: number;
  valuation_source: string;
  source_badge: 'real_exact' | 'ai_ml_model' | 'ai_model_baseline';
}

interface RoadProfile {
  name: string;
  price_per_wah: number;
  lat: number;
  lon: number;
  radius_deg: number;
}

interface SubdistrictProfile {
  district: string;
  province: string;
  zone_name: string;
  base_rate: number;
  center_lat: number;
  center_lon: number;
  roads: RoadProfile[];
}

const SUBDISTRICT_DATABASE: Record<string, SubdistrictProfile> = {
  'หาดใหญ่': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซน CBD ใจกลางเมืองหาดใหญ่',
    base_rate: 38000,
    center_lat: 7.0084,
    center_lon: 100.4767,
    roads: [
      { name: 'ถนนเสน่หานุสรณ์ (ใจกลางเมือง/ลีการ์เด้นส์)', price_per_wah: 380000, lat: 7.0045, lon: 100.4705, radius_deg: 0.008 },
      { name: 'ถนนนิพัทธ์อุทิศ 1', price_per_wah: 240000, lat: 7.0050, lon: 100.4680, radius_deg: 0.010 },
      { name: 'ถนนนิพัทธ์อุทิศ 2', price_per_wah: 280000, lat: 7.0050, lon: 100.4695, radius_deg: 0.010 },
      { name: 'ถนนนิพัทธ์อุทิศ 3', price_per_wah: 320000, lat: 7.0050, lon: 100.4710, radius_deg: 0.010 },
      { name: 'ถนนธรรมนูญวิถี', price_per_wah: 220000, lat: 7.0035, lon: 100.4715, radius_deg: 0.012 },
      { name: 'ถนนศุภสารรังสรรค์', price_per_wah: 150000, lat: 7.0085, lon: 100.4735, radius_deg: 0.012 },
      { name: 'ถนนเพชรเกษม (สายหลักใจกลางเมือง)', price_per_wah: 140000, lat: 7.0150, lon: 100.4750, radius_deg: 0.020 },
      { name: 'ถนนราษฎร์อุทิศ (ย่านเขต 8)', price_per_wah: 110000, lat: 7.0120, lon: 100.4620, radius_deg: 0.015 },
      { name: 'ถนนศรีภูวนารถ', price_per_wah: 95000, lat: 6.9960, lon: 100.4780, radius_deg: 0.015 },
      { name: 'ถนนสามชัย', price_per_wah: 90000, lat: 7.0060, lon: 100.4850, radius_deg: 0.012 },
      { name: 'ถนนจิระนคร', price_per_wah: 75000, lat: 7.0090, lon: 100.4670, radius_deg: 0.008 },
      { name: 'ถนนประชาธิปัตย์', price_per_wah: 120000, lat: 7.0040, lon: 100.4700, radius_deg: 0.008 },
      { name: 'ถนนแสงศรี', price_per_wah: 85000, lat: 7.0070, lon: 100.4750, radius_deg: 0.010 },
      { name: 'ถนนพลพิชัย', price_per_wah: 50000, lat: 6.9950, lon: 100.4620, radius_deg: 0.015 },
      { name: 'ถนนรัถการ (รพ.หาดใหญ่)', price_per_wah: 70000, lat: 7.0110, lon: 100.4650, radius_deg: 0.012 },
    ]
  },
  'คอหงส์': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซน ม.อ. - ศูนย์การแพทย์ - ปุณณกัณฑ์ - เซ็นทรัล',
    base_rate: 20000,
    center_lat: 7.0050,
    center_lon: 100.5100,
    roads: [
      { name: 'ถนนกาญจนวณิชย์ (หน้า ม.อ. / เซ็นทรัลหาดใหญ่)', price_per_wah: 110000, lat: 7.0050, lon: 100.4980, radius_deg: 0.018 },
      { name: 'ถนนปุณณกัณฑ์ (ประตู 109 ม.อ.)', price_per_wah: 60000, lat: 7.0020, lon: 100.5050, radius_deg: 0.015 },
      { name: 'ถนนทวีรัตน์ (ย่านชุมชนคอหงส์)', price_per_wah: 42000, lat: 6.9920, lon: 100.5020, radius_deg: 0.015 },
      { name: 'ถนนธรรมนูญวิถี (ส่วนขยายคอหงส์)', price_per_wah: 48000, lat: 7.0010, lon: 100.4900, radius_deg: 0.010 },
      { name: 'ถนนบ้านทุ่งรี (หลัง ม.อ.)', price_per_wah: 38000, lat: 7.0000, lon: 100.5080, radius_deg: 0.012 },
      { name: 'ซอย 10 เพชรเกษม', price_per_wah: 34000, lat: 7.0180, lon: 100.4950, radius_deg: 0.012 },
    ]
  },
  'คลองแห': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนคลองแห - Bypass ลพบุรีราเมศวร์ - ตลาดน้ำ',
    base_rate: 13000,
    center_lat: 7.0450,
    center_lon: 100.4850,
    roads: [
      { name: 'ถนนลพบุรีราเมศวร์ (ช่วงคลองแห)', price_per_wah: 55000, lat: 7.0420, lon: 100.4780, radius_deg: 0.020 },
      { name: 'ถนนบิ๊กซีคลองแห', price_per_wah: 42000, lat: 7.0380, lon: 100.4720, radius_deg: 0.010 },
      { name: 'ถนนคลองแห-คูเต่า (ตลาดน้ำคลองแห)', price_per_wah: 28000, lat: 7.0480, lon: 100.4850, radius_deg: 0.018 },
      { name: 'ถนนประชาสรรค์', price_per_wah: 22000, lat: 7.0350, lon: 100.4800, radius_deg: 0.012 },
    ]
  },
  'ควนลัง': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนควนลัง - ท่าอากาศยานนานาชาติหาดใหญ่ (HDY)',
    base_rate: 14000,
    center_lat: 6.9920,
    center_lon: 100.4350,
    roads: [
      { name: 'ถนนเพชรเกษม (ช่วงควนลัง)', price_per_wah: 58000, lat: 6.9950, lon: 100.4350, radius_deg: 0.020 },
      { name: 'ถนนสายสนามบินนานาชาติหาดใหญ่ (ทล.4135)', price_per_wah: 52000, lat: 6.9600, lon: 100.4150, radius_deg: 0.025 },
      { name: 'ถนนควนลัง-บ้านพรุ', price_per_wah: 25000, lat: 6.9700, lon: 100.4500, radius_deg: 0.018 },
      { name: 'ถนนบ้านเนิน-คลองต่ำ', price_per_wah: 20000, lat: 6.9800, lon: 100.4400, radius_deg: 0.015 },
    ]
  },
  'บ้านพรุ': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนบ้านพรุ - ชุมชนเมืองใหม่ตอนใต้',
    base_rate: 11000,
    center_lat: 6.9400,
    center_lon: 100.4800,
    roads: [
      { name: 'ถนนกาญจนวณิชย์ (ช่วงบ้านพรุ)', price_per_wah: 48000, lat: 6.9450, lon: 100.4850, radius_deg: 0.020 },
      { name: 'ถนนราษฎร์บำรุง (เทศบาลบ้านพรุ)', price_per_wah: 25000, lat: 6.9400, lon: 100.4800, radius_deg: 0.012 },
      { name: 'ถนนบ้านพรุ-โปะหมอ', price_per_wah: 20000, lat: 6.9350, lon: 100.4900, radius_deg: 0.015 },
    ]
  },
  'พะตง': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนพะตง - ตลาดทุ่งลุง - ประตูสู่ตอนใต้',
    base_rate: 4500,
    center_lat: 6.8400,
    center_lon: 100.5200,
    roads: [
      { name: 'ถนนกาญจนวณิชย์ (ตลาดทุ่งลุง)', price_per_wah: 26000, lat: 6.8400, lon: 100.5250, radius_deg: 0.018 },
      { name: 'ถนนเทศบาลพะตง', price_per_wah: 14000, lat: 6.8420, lon: 100.5200, radius_deg: 0.010 },
      { name: 'ถนนพะตง-คลองแงะ', price_per_wah: 8500, lat: 6.8350, lon: 100.5300, radius_deg: 0.015 },
    ]
  },
  'ทุ่งใหญ่': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนทุ่งใหญ่ - แนวระเบียงเศรษฐกิจสายเอเชีย',
    base_rate: 5500,
    center_lat: 7.0200,
    center_lon: 100.5700,
    roads: [
      { name: 'ถนนสายเอเชีย (ทล.43)', price_per_wah: 28000, lat: 7.0250, lon: 100.5650, radius_deg: 0.025 },
      { name: 'ถนนสายทุ่งใหญ่-ท่าข้าม', price_per_wah: 12000, lat: 7.0200, lon: 100.5750, radius_deg: 0.018 },
    ]
  },
  'ทุ่งตำเสา': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนทุ่งตำเสา - น้ำตกโตนงาช้างและชุมชนเกษตร',
    base_rate: 3600,
    center_lat: 6.9500,
    center_lon: 100.3400,
    roads: [
      { name: 'ถนนเพชรเกษม (ช่วงทุ่งตำเสา)', price_per_wah: 21000, lat: 6.9550, lon: 100.3450, radius_deg: 0.025 },
      { name: 'ถนนบ้านทุ่งตำเสา-หูแร่', price_per_wah: 7500, lat: 6.9450, lon: 100.3350, radius_deg: 0.018 },
    ]
  },
  'ท่าข้าม': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนท่าข้าม - ทางหลวงสายเก่าเชื่อมสงขลา',
    base_rate: 5000,
    center_lat: 7.0700,
    center_lon: 100.5600,
    roads: [
      { name: 'ถนนสงขลา-หาดใหญ่ สายเก่า (ทล.407)', price_per_wah: 24000, lat: 7.0650, lon: 100.5600, radius_deg: 0.020 },
      { name: 'ถนนสายท่าข้าม-ควนมัด', price_per_wah: 9000, lat: 7.0720, lon: 100.5680, radius_deg: 0.018 },
    ]
  },
  'น้ำน้อย': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนน้ำน้อย - ชุมชนเชื่อมต่ออำเภอเมืองสงขลา',
    base_rate: 6500,
    center_lat: 7.0750,
    center_lon: 100.5250,
    roads: [
      { name: 'ถนนกาญจนวณิชย์ (ช่วงน้ำน้อย)', price_per_wah: 33000, lat: 7.0750, lon: 100.5280, radius_deg: 0.020 },
      { name: 'ถนนลพบุรีราเมศวร์ (ช่วงน้ำน้อย)', price_per_wah: 30000, lat: 7.0700, lon: 100.5180, radius_deg: 0.020 },
      { name: 'ถนนสายน้ำน้อย-ท่านางหอม', price_per_wah: 12000, lat: 7.0800, lon: 100.5350, radius_deg: 0.015 },
    ]
  },
  'คลองอู่ตะเภา': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนคลองอู่ตะเภา - ย่านชานเมืองตอนเหนือ',
    base_rate: 5000,
    center_lat: 7.0500,
    center_lon: 100.4500,
    roads: [
      { name: 'ถนนลพบุรีราเมศวร์ (ช่วงเลียบคลองอู่ตะเภา)', price_per_wah: 26000, lat: 7.0500, lon: 100.4550, radius_deg: 0.020 },
      { name: 'ถนนเลียบทางรถไฟคลองอู่ตะเภา', price_per_wah: 13000, lat: 7.0550, lon: 100.4480, radius_deg: 0.015 },
    ]
  },
  'ฉลุง': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนฉลุง - เกษตรกรรมและสวนผลไม้เชิงเขา',
    base_rate: 2800,
    center_lat: 6.9000,
    center_lon: 100.3200,
    roads: [
      { name: 'ถนนทางหลวงชนบท สข.4042 (ฉลุง)', price_per_wah: 16000, lat: 6.9050, lon: 100.3250, radius_deg: 0.025 },
      { name: 'ถนนบ้านฉลุง-ทุ่งตำเสา', price_per_wah: 6500, lat: 6.8950, lon: 100.3150, radius_deg: 0.018 },
    ]
  },
  'คูเต่า': {
    district: 'อำเภอหาดใหญ่',
    province: 'สงขลา',
    zone_name: 'โซนคูเต่า - แหลมโพธิ์และชุมชนชายฝั่งทะเลสาบ',
    base_rate: 2400,
    center_lat: 7.1100,
    center_lon: 100.4800,
    roads: [
      { name: 'ถนนสายหาดใหญ่-คูเต่า (ทล.4113)', price_per_wah: 13500, lat: 7.1050, lon: 100.4850, radius_deg: 0.020 },
      { name: 'ถนนเลียบคลองภูมินาถดำริ', price_per_wah: 7000, lat: 7.1150, lon: 100.4780, radius_deg: 0.018 },
      { name: 'ถนนบ้านแหลมโพธิ์-คูเต่า', price_per_wah: 5000, lat: 7.1200, lon: 100.4900, radius_deg: 0.015 },
    ]
  },
};

/**
 * Instantly resolve the official reference appraisal rate for any given (lat, lon) in Hat Yai.
 * Returns in <1ms without network calls.
 */
export function resolveZoneAppraisalRate(lat: number, lon: number): ZonePricingResult {
  // 1. Find nearest subdistrict
  let bestSubdistrict = 'หาดใหญ่';
  let minSubdistrictDist = Infinity;

  for (const [name, prof] of Object.entries(SUBDISTRICT_DATABASE)) {
    const d = Math.hypot(lat - prof.center_lat, lon - prof.center_lon);
    if (d < minSubdistrictDist) {
      minSubdistrictDist = d;
      bestSubdistrict = name;
    }
  }

  const profile = SUBDISTRICT_DATABASE[bestSubdistrict] || SUBDISTRICT_DATABASE['หาดใหญ่'];

  // 2. Check if near any specific major surveyed road in this subdistrict
  let matchedRoad: RoadProfile | null = null;
  let minRoadDist = Infinity;

  for (const road of profile.roads) {
    const d = Math.hypot(lat - road.lat, lon - road.lon);
    if (d <= road.radius_deg && d < minRoadDist) {
      minRoadDist = d;
      matchedRoad = road;
    }
  }

  if (matchedRoad) {
    const priceWah = matchedRoad.price_per_wah;
    return {
      subdistrict: bestSubdistrict,
      district: profile.district,
      province: profile.province,
      zone_name: profile.zone_name,
      road_name: matchedRoad.name,
      price_per_wah: priceWah,
      price_per_sqm: Math.round(priceWah / 4),
      valuation_source: `บัญชีราคาประเมินทุนทรัพย์ที่ดิน (${matchedRoad.name})`,
      source_badge: 'real_exact',
    };
  }

  // Fallback to subdistrict base rate
  const priceWah = profile.base_rate;
  return {
    subdistrict: bestSubdistrict,
    district: profile.district,
    province: profile.province,
    zone_name: profile.zone_name,
    road_name: `เขตพื้นที่ ต.${bestSubdistrict}`,
    price_per_wah: priceWah,
    price_per_sqm: Math.round(priceWah / 4),
    valuation_source: `อัตราฐานราคาประเมิน ต.${bestSubdistrict}`,
    source_badge: 'ai_model_baseline',
  };
}
