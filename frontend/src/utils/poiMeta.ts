import L from 'leaflet';

export interface POIMeta {
  categoryKey: string;
  emoji: string;
  color: string;
  bgLight: string;
  borderLight: string;
  label: string;
  labelTh: string;
}

export interface POIItemLike {
  category?: string;
  name?: string;
  tags?: Record<string, string>;
  [key: string]: any;
}

// Preset library of POI categories with vibrant, distinct visual themes
export const POI_CATEGORIES_PRESETS: Record<string, POIMeta> = {
  hospital: {
    categoryKey: 'hospital',
    emoji: '🏥',
    color: '#ef4444',
    bgLight: 'rgba(239, 68, 68, 0.18)',
    borderLight: 'rgba(239, 68, 68, 0.55)',
    label: 'Hospital & Healthcare',
    labelTh: 'โรงพยาบาล / ศูนย์การแพทย์',
  },
  pharmacy: {
    categoryKey: 'pharmacy',
    emoji: '💊',
    color: '#f43f5e',
    bgLight: 'rgba(244, 63, 94, 0.18)',
    borderLight: 'rgba(244, 63, 94, 0.55)',
    label: 'Pharmacy',
    labelTh: 'ร้านขายยา / เภสัชกรรม',
  },
  university: {
    categoryKey: 'university',
    emoji: '🎓',
    color: '#6366f1',
    bgLight: 'rgba(99, 102, 241, 0.18)',
    borderLight: 'rgba(99, 102, 241, 0.55)',
    label: 'University & College',
    labelTh: 'มหาวิทยาลัย / สถาบันอุดมศึกษา',
  },
  school: {
    categoryKey: 'school',
    emoji: '🏫',
    color: '#f59e0b',
    bgLight: 'rgba(245, 158, 11, 0.18)',
    borderLight: 'rgba(245, 158, 11, 0.55)',
    label: 'School',
    labelTh: 'โรงเรียน / สถานศึกษา',
  },
  airport: {
    categoryKey: 'airport',
    emoji: '✈️',
    color: '#0284c7',
    bgLight: 'rgba(2, 132, 199, 0.18)',
    borderLight: 'rgba(2, 132, 199, 0.55)',
    label: 'Airport & Aviation',
    labelTh: 'ท่าอากาศยานนานาชาติ / สนามบิน',
  },
  train: {
    categoryKey: 'train',
    emoji: '🚆',
    color: '#8b5cf6',
    bgLight: 'rgba(139, 92, 246, 0.18)',
    borderLight: 'rgba(139, 92, 246, 0.55)',
    label: 'Railway Station',
    labelTh: 'สถานีรถไฟ / ระบบราง',
  },
  bus: {
    categoryKey: 'bus',
    emoji: '🚌',
    color: '#06b6d4',
    bgLight: 'rgba(6, 182, 212, 0.18)',
    borderLight: 'rgba(6, 182, 212, 0.55)',
    label: 'Bus Station & Transit',
    labelTh: 'สถานีขนส่งผู้โดยสาร / คิวรถ',
  },
  mall: {
    categoryKey: 'mall',
    emoji: '🛍️',
    color: '#ec4899',
    bgLight: 'rgba(236, 72, 153, 0.18)',
    borderLight: 'rgba(236, 72, 153, 0.55)',
    label: 'Shopping Mall',
    labelTh: 'ห้างสรรพสินค้า / ศูนย์การค้า',
  },
  market: {
    categoryKey: 'market',
    emoji: '🛒',
    color: '#10b981',
    bgLight: 'rgba(16, 185, 129, 0.18)',
    borderLight: 'rgba(16, 185, 129, 0.55)',
    label: 'Marketplace',
    labelTh: 'ตลาดสด / ตลาดนัดย่านการค้า',
  },
  supermarket: {
    categoryKey: 'supermarket',
    emoji: '🏪',
    color: '#14b8a6',
    bgLight: 'rgba(20, 184, 166, 0.18)',
    borderLight: 'rgba(20, 184, 166, 0.55)',
    label: 'Supermarket / Convenience',
    labelTh: 'ซูเปอร์มาร์เก็ต / ร้านสะดวกซื้อ',
  },
  bank: {
    categoryKey: 'bank',
    emoji: '🏦',
    color: '#3b82f6',
    bgLight: 'rgba(59, 130, 246, 0.18)',
    borderLight: 'rgba(59, 130, 246, 0.55)',
    label: 'Bank & Finance',
    labelTh: 'ธนาคาร / สถาบันการเงิน',
  },
  fuel: {
    categoryKey: 'fuel',
    emoji: '⛽',
    color: '#f97316',
    bgLight: 'rgba(249, 115, 22, 0.18)',
    borderLight: 'rgba(249, 115, 22, 0.55)',
    label: 'Gas Station & EV',
    labelTh: 'สถานีบริการน้ำมัน / ชาร์จ EV',
  },
  hotel: {
    categoryKey: 'hotel',
    emoji: '🏨',
    color: '#a855f7',
    bgLight: 'rgba(168, 85, 247, 0.18)',
    borderLight: 'rgba(168, 85, 247, 0.55)',
    label: 'Hotel & Hospitality',
    labelTh: 'โรงแรม / รีสอร์ตและที่พัก',
  },
  government: {
    categoryKey: 'government',
    emoji: '🏛️',
    color: '#64748b',
    bgLight: 'rgba(100, 116, 139, 0.18)',
    borderLight: 'rgba(100, 116, 139, 0.55)',
    label: 'Government & Civic',
    labelTh: 'สถานที่ราชการ / ที่ว่าการอำเภอ',
  },
  police: {
    categoryKey: 'police',
    emoji: '👮',
    color: '#1d4ed8',
    bgLight: 'rgba(29, 78, 216, 0.18)',
    borderLight: 'rgba(29, 78, 216, 0.55)',
    label: 'Police Station',
    labelTh: 'สถานีตำรวจภูธร / ป้อมตำรวจ',
  },
  fire_station: {
    categoryKey: 'fire_station',
    emoji: '🚒',
    color: '#dc2626',
    bgLight: 'rgba(220, 38, 38, 0.18)',
    borderLight: 'rgba(220, 38, 38, 0.55)',
    label: 'Fire Station',
    labelTh: 'สถานีดับเพลิงและบรรเทาสาธารณภัย',
  },
  temple: {
    categoryKey: 'temple',
    emoji: '🛕',
    color: '#eab308',
    bgLight: 'rgba(234, 179, 8, 0.18)',
    borderLight: 'rgba(234, 179, 8, 0.55)',
    label: 'Buddhist Temple',
    labelTh: 'วัด / พุทธศาสนสถาน',
  },
  mosque: {
    categoryKey: 'mosque',
    emoji: '🕌',
    color: '#059669',
    bgLight: 'rgba(5, 150, 105, 0.18)',
    borderLight: 'rgba(5, 150, 105, 0.55)',
    label: 'Mosque',
    labelTh: 'มัสยิด / ศาสนสถานอิสลาม',
  },
  church: {
    categoryKey: 'church',
    emoji: '⛪',
    color: '#0284c7',
    bgLight: 'rgba(2, 132, 199, 0.18)',
    borderLight: 'rgba(2, 132, 199, 0.55)',
    label: 'Church',
    labelTh: 'โบสถ์คริสต์ / คริสตจักร',
  },
  park: {
    categoryKey: 'park',
    emoji: '🌳',
    color: '#22c55e',
    bgLight: 'rgba(34, 197, 94, 0.18)',
    borderLight: 'rgba(34, 197, 94, 0.55)',
    label: 'Park & Recreation',
    labelTh: 'สวนสาธารณะ / นันทนาการ',
  },
  restaurant: {
    categoryKey: 'restaurant',
    emoji: '🍽️',
    color: '#ea580c',
    bgLight: 'rgba(234, 88, 12, 0.18)',
    borderLight: 'rgba(234, 88, 12, 0.55)',
    label: 'Restaurant',
    labelTh: 'ร้านอาหาร / ภัตตาคาร',
  },
  cafe: {
    categoryKey: 'cafe',
    emoji: '☕',
    color: '#b45309',
    bgLight: 'rgba(180, 83, 9, 0.18)',
    borderLight: 'rgba(180, 83, 9, 0.55)',
    label: 'Cafe & Coffee',
    labelTh: 'คาเฟ่ / ร้านกาแฟ',
  },
  attraction: {
    categoryKey: 'attraction',
    emoji: '🏖️',
    color: '#0ea5e9',
    bgLight: 'rgba(14, 165, 233, 0.18)',
    borderLight: 'rgba(14, 165, 233, 0.55)',
    label: 'Tourist Attraction',
    labelTh: 'แหล่งท่องเที่ยว / จุดชมวิว',
  },
  general: {
    categoryKey: 'general',
    emoji: '📍',
    color: '#06b6d4',
    bgLight: 'rgba(6, 182, 212, 0.18)',
    borderLight: 'rgba(6, 182, 212, 0.55)',
    label: 'Landmark / Point of Interest',
    labelTh: 'สถานที่สำคัญทั่วไป',
  },
};

/**
 * Smart Classifier for any POI record (Overpass API or Curated Landmark GeoJSON)
 */
export const getPOIMeta = (poi: POIItemLike): POIMeta => {
  const name = (poi.name || poi.tags?.name || '').toLowerCase();
  const amenity = (poi.tags?.amenity || '').toLowerCase();
  const shop = (poi.tags?.shop || '').toLowerCase();
  const tourism = (poi.tags?.tourism || '').toLowerCase();
  const leisure = (poi.tags?.leisure || '').toLowerCase();
  const aeroway = (poi.tags?.aeroway || '').toLowerCase();
  const railway = (poi.tags?.railway || '').toLowerCase();
  const category = (poi.category || poi.tags?.category || '').toLowerCase();
  const religion = (poi.tags?.religion || '').toLowerCase();

  // 1. Airport / Aviation
  if (
    aeroway.includes('aero') ||
    aeroway.includes('terminal') ||
    category === 'airport' ||
    name.includes('สนามบิน') ||
    name.includes('ท่าอากาศยาน') ||
    name.includes('airport')
  ) {
    return POI_CATEGORIES_PRESETS.airport;
  }

  // 2. Train / Railway
  if (
    railway.includes('station') ||
    category === 'train' ||
    name.includes('สถานีรถไฟ') ||
    name.includes('ชุมทางหาดใหญ่') ||
    name.includes('railway')
  ) {
    return POI_CATEGORIES_PRESETS.train;
  }

  // 3. Bus Station / Transit
  if (
    amenity === 'bus_station' ||
    category === 'bus' ||
    name.includes('สถานีขนส่ง') ||
    name.includes('บขส') ||
    name.includes('คิวรถ')
  ) {
    return POI_CATEGORIES_PRESETS.bus;
  }

  // 4. Transport category fallback from hatyai_landmarks.json
  if (category === 'transport') {
    if (name.includes('บิน') || name.includes('airport') || name.includes('อากาศยาน')) return POI_CATEGORIES_PRESETS.airport;
    if (name.includes('รถไฟ')) return POI_CATEGORIES_PRESETS.train;
    return POI_CATEGORIES_PRESETS.bus;
  }

  // 5. Hospital / Medical
  if (
    amenity === 'hospital' ||
    amenity === 'clinic' ||
    amenity === 'doctors' ||
    category === 'hospital' ||
    name.includes('โรงพยาบาล') ||
    name.includes('รพ.') ||
    name.includes('คลินิก') ||
    name.includes('ศูนย์การแพทย์')
  ) {
    return POI_CATEGORIES_PRESETS.hospital;
  }

  // 6. Pharmacy
  if (amenity === 'pharmacy' || shop === 'chemist' || name.includes('ร้านขายยา') || name.includes('เภสัช')) {
    return POI_CATEGORIES_PRESETS.pharmacy;
  }

  // 7. University & Higher Education
  if (
    amenity === 'university' ||
    amenity === 'college' ||
    category === 'university' ||
    name.includes('มหาวิทยาลัย') ||
    name.includes('ม.อ.') ||
    name.includes('ม.หาดใหญ่')
  ) {
    return POI_CATEGORIES_PRESETS.university;
  }

  // 8. School
  if (
    amenity === 'school' ||
    amenity === 'kindergarten' ||
    category === 'school' ||
    name.includes('โรงเรียน') ||
    name.includes('รร.') ||
    name.includes('วิทยาลัย')
  ) {
    return POI_CATEGORIES_PRESETS.school;
  }

  // 9. Shopping Mall
  if (
    shop === 'mall' ||
    shop === 'department_store' ||
    name.includes('เซ็นทรัล') ||
    name.includes('central') ||
    name.includes('ไดอาน่า') ||
    name.includes('diana') ||
    name.includes('โรบินสัน') ||
    name.includes('เดอะมอลล์') ||
    name.includes('ห้าง')
  ) {
    return POI_CATEGORIES_PRESETS.mall;
  }

  // 10. Commercial category fallback from hatyai_landmarks.json
  if (category === 'commercial') {
    if (name.includes('เซ็นทรัล') || name.includes('mall') || name.includes('ห้าง')) return POI_CATEGORIES_PRESETS.mall;
    return POI_CATEGORIES_PRESETS.market;
  }

  // 11. Market / Traditional market
  if (
    amenity === 'marketplace' ||
    category === 'market' ||
    name.includes('ตลาด') ||
    name.includes('กิมหยง') ||
    name.includes('สันติสุข') ||
    name.includes('คลองแห')
  ) {
    return POI_CATEGORIES_PRESETS.market;
  }

  // 12. Supermarket / Convenience Store
  if (
    shop === 'supermarket' ||
    shop === 'convenience' ||
    name.includes('โลตัส') ||
    name.includes('บิ๊กซี') ||
    name.includes('แม็คโคร') ||
    name.includes('ท็อปส์') ||
    name.includes('7-eleven') ||
    name.includes('เซเว่น')
  ) {
    return POI_CATEGORIES_PRESETS.supermarket;
  }

  // 13. Bank & Finance
  if (amenity === 'bank' || amenity === 'atm' || name.includes('ธนาคาร') || name.includes('bank')) {
    return POI_CATEGORIES_PRESETS.bank;
  }

  // 14. Fuel Station & EV Charging
  if (
    amenity === 'fuel' ||
    amenity === 'charging_station' ||
    name.includes('ปั๊ม') ||
    name.includes('ปตท') ||
    name.includes('บางจาก') ||
    name.includes('ptt') ||
    name.includes('shell') ||
    name.includes('caltex')
  ) {
    return POI_CATEGORIES_PRESETS.fuel;
  }

  // 15. Hotel & Hospitality
  if (
    tourism === 'hotel' ||
    tourism === 'motel' ||
    tourism === 'guest_house' ||
    name.includes('โรงแรม') ||
    name.includes('รีสอร์ท') ||
    name.includes('hotel') ||
    name.includes('resort')
  ) {
    return POI_CATEGORIES_PRESETS.hotel;
  }

  // 16. Religion / Places of Worship
  if (
    religion === 'muslim' ||
    name.includes('มัสยิด') ||
    name.includes('สุเหร่า') ||
    name.includes('mosque')
  ) {
    return POI_CATEGORIES_PRESETS.mosque;
  }

  if (
    religion === 'buddhist' ||
    name.includes('วัด') ||
    name.includes('อาราม') ||
    name.includes('สำนักสงฆ์') ||
    name.includes('เจดีย์') ||
    name.includes('temple')
  ) {
    return POI_CATEGORIES_PRESETS.temple;
  }

  if (
    religion === 'christian' ||
    name.includes('โบสถ์') ||
    name.includes('คริสตจักร') ||
    name.includes('church')
  ) {
    return POI_CATEGORIES_PRESETS.church;
  }

  // 17. Government & Civic
  if (
    amenity === 'townhall' ||
    amenity === 'courthouse' ||
    amenity === 'post_office' ||
    amenity === 'community_centre' ||
    name.includes('เทศบาล') ||
    name.includes('ที่ว่าการ') ||
    name.includes('อำเภอ') ||
    name.includes('ศาล') ||
    name.includes('สำนักงานที่ดิน') ||
    name.includes('ไปรษณีย์')
  ) {
    return POI_CATEGORIES_PRESETS.government;
  }

  // 18. Police Station
  if (amenity === 'police' || name.includes('ตำรวจ') || name.includes('สภ.')) {
    return POI_CATEGORIES_PRESETS.police;
  }

  // 19. Fire Station
  if (amenity === 'fire_station' || name.includes('ดับเพลิง')) {
    return POI_CATEGORIES_PRESETS.fire_station;
  }

  // 20. Park & Recreation
  if (
    leisure === 'park' ||
    leisure === 'garden' ||
    leisure === 'sports_centre' ||
    leisure === 'stadium' ||
    name.includes('สวนสาธารณะ') ||
    name.includes('สวนสุขภาพ') ||
    name.includes('เขาคอหงส์')
  ) {
    return POI_CATEGORIES_PRESETS.park;
  }

  // 21. Restaurant & Food
  if (
    amenity === 'restaurant' ||
    amenity === 'fast_food' ||
    amenity === 'food_court' ||
    name.includes('ร้านอาหาร') ||
    name.includes('ภัตตาคาร') ||
    name.includes('ครัว')
  ) {
    return POI_CATEGORIES_PRESETS.restaurant;
  }

  // 22. Cafe & Coffee
  if (amenity === 'cafe' || name.includes('คาเฟ่') || name.includes('กาแฟ') || name.includes('cafe') || name.includes('coffee')) {
    return POI_CATEGORIES_PRESETS.cafe;
  }

  // 23. Tourist Attraction / Viewpoint / Museum
  if (
    tourism === 'attraction' ||
    tourism === 'viewpoint' ||
    tourism === 'museum' ||
    name.includes('จุดชมวิว') ||
    name.includes('พิพิธภัณฑ์') ||
    name.includes('อนุสาวรีย์')
  ) {
    return POI_CATEGORIES_PRESETS.attraction;
  }

  // Default fallback
  const fallbackLabel = poi.category || amenity || shop || 'สถานที่สำคัญ';
  return {
    ...POI_CATEGORIES_PRESETS.general,
    label: fallbackLabel,
    labelTh: fallbackLabel,
  };
};

/**
 * Creates an ultra-crisp, animated Leaflet DivIcon with category-themed glow & emoji badge
 */
export const createPOIIcon = (meta: POIMeta, isSelected: boolean = false) => {
  const pinSize = isSelected ? 38 : 32;
  const emojiSize = isSelected ? 18 : 15;
  const shadowSpread = isSelected ? 14 : 8;

  return L.divIcon({
    className: 'custom-poi-div',
    html: `
      <div class="landmark-pin-container ${isSelected ? 'is-selected' : ''}" style="cursor: pointer;">
        <div class="landmark-pulse" style="background: ${meta.color};"></div>
        <div class="landmark-pin" style="
          width: ${pinSize}px;
          height: ${pinSize}px;
          background: radial-gradient(circle at 30% 30%, #ffffff 0%, ${meta.color} 75%);
          box-shadow: 0 4px ${shadowSpread}px ${meta.color}aa, 0 0 0 2px rgba(255, 255, 255, 0.95);
        ">
          <span style="font-size: ${emojiSize}px; line-height: 1; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); user-select: none;">
            ${meta.emoji}
          </span>
        </div>
      </div>
    `,
    iconSize: [pinSize, pinSize],
    iconAnchor: [pinSize / 2, pinSize / 2],
    popupAnchor: [0, -(pinSize / 2 + 4)],
  });
};
