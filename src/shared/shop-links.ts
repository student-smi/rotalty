/** Contact buttons for a shop: only links the owner has filled in (or that we can derive) are returned. */
export interface ShopLinks {
  whatsapp: string | null;
  instagram: string | null;
  directions: string | null;
  call: string | null;
  website: string | null;
}

interface ShopFields {
  name: string;
  phone: string | null;
  whatsappNumber: string | null;
  instagramHandle: string | null;
  websiteUrl: string | null;
  googlePlaceId: string | null;
  latitude: number | null;
  longitude: number | null;
  addressLine: string | null;
  city: string | null;
}

const intl = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `91${d}` : d;
};

export function shopLinks(b: ShopFields): ShopLinks {
  const wa = b.whatsappNumber ?? b.phone;
  let directions: string | null = null;
  // Google Maps URLs (documented "search" form). The place id gives the exact listing.
  if (b.googlePlaceId) directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.name)}&query_place_id=${encodeURIComponent(b.googlePlaceId)}`;
  else if (b.latitude != null && b.longitude != null) directions = `https://www.google.com/maps/search/?api=1&query=${b.latitude},${b.longitude}`;
  else if (b.addressLine || b.city) directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([b.name, b.addressLine, b.city].filter(Boolean).join(", "))}`;
  return {
    whatsapp: wa ? `https://wa.me/${intl(wa)}` : null,
    instagram: b.instagramHandle ? `https://www.instagram.com/${encodeURIComponent(b.instagramHandle)}/` : null,
    directions,
    call: b.phone ? `tel:+${intl(b.phone)}` : null,
    website: b.websiteUrl,
  };
}
