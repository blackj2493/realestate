/** /open-houses and /open-houses/{city}. Kept apart from openHouses.ts so the sitemap, IndexNow and
 *  city topic code do not load the database and search clients. */
export const openHousesPath = (slug?: string) => (slug ? `/open-houses/${slug}` : "/open-houses");
