// Shared category / booking-type vocabulary.

export const CATEGORIES = [
  { value: 'transport', label: 'Transport' },
  { value: 'stay', label: 'Stay' },
  { value: 'food', label: 'Food' },
  { value: 'activity', label: 'Activity' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'other', label: 'Other' },
];

export const BOOKING_TYPES = [
  { value: 'flight', label: 'Flight', cat: 'transport' },
  { value: 'train', label: 'Train / bus', cat: 'transport' },
  { value: 'car', label: 'Car / transfer', cat: 'transport' },
  { value: 'stay', label: 'Stay', cat: 'stay' },
  { value: 'restaurant', label: 'Restaurant', cat: 'food' },
  { value: 'activity', label: 'Activity / tickets', cat: 'activity' },
  { value: 'other', label: 'Other', cat: 'other' },
];

const catValues = new Set(CATEGORIES.map((c) => c.value));

export const safeCat = (c) => (catValues.has(c) ? c : 'other');
export const catLabel = (c) => (CATEGORIES.find((x) => x.value === c) || CATEGORIES[5]).label;
export const catColorVar = (c) => `var(--c-${safeCat(c)})`;
export const bookingType = (t) => BOOKING_TYPES.find((x) => x.value === t) || BOOKING_TYPES[BOOKING_TYPES.length - 1];
