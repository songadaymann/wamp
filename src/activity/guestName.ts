const COLORS = ['Amber', 'Blue', 'Coral', 'Gold', 'Green', 'Indigo', 'Lime', 'Mint',
  'Orange', 'Pink', 'Plum', 'Red', 'Silver', 'Teal', 'Violet', 'Yellow'];
const ANIMALS = ['Badger', 'Cat', 'Crab', 'Deer', 'Duck', 'Fox', 'Frog', 'Gecko',
  'Hare', 'Koala', 'Moth', 'Otter', 'Owl', 'Panda', 'Robin', 'Turtle'];

/** Stable across rooms and old events, without publishing the browser identity. */
export async function activityGuestName(guestId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`wamp-activity-guest-v1:${guestId}`)));
  const tag = Array.from(digest.slice(1, 5), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `Guest ${COLORS[digest[0] >> 4]} ${ANIMALS[digest[0] & 15]} ${tag}`;
}
