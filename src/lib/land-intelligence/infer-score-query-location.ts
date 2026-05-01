const US_STATE_NAMES = new Set([
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada',
  'new hampshire','new jersey','new mexico','new york','north carolina',
  'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west virginia','wisconsin','wyoming',
  // abbreviations
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia',
  'ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj',
  'nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt',
  'va','wa','wv','wi','wy',
]);

export function inferScoreQueryLocation(location: string, coordinates?: [number, number]) {
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^india$/i.test(part));

  const district = parts[0] || location.trim() || 'Unknown';
  const state = parts.length > 1 ? parts[parts.length - 1] : district;

  let isUS = parts.some(
    (p) =>
      /united states|usa|u\.s\.a/i.test(p) ||
      US_STATE_NAMES.has(p.toLowerCase()),
  );

  // Coordinate-based fallback: check if within contiguous US
  if (!isUS && coordinates) {
    const [lng, lat] = coordinates;
    if (lat >= 24.5 && lat <= 49.5 && lng >= -125 && lng <= -66) {
      isUS = true;
    }
  }

  return { state, district, isUS };
}
