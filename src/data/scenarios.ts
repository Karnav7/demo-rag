// Ids of the seeded investigation scenarios in world.json (see scripts/gen-world.ts).
// Tests, the retrieval engine and UI suggestion chips refer to scenario entities through these.

/** 1. Layered ownership: US operating company owned via UK -> EU -> offshore shells. */
export const MERIDIAN = 'co-meridian-trade'
export const MERIDIAN_NAME = 'Meridian Trade LLC'
/** Ownership chain from Meridian upwards, ending at the beneficial owner. */
export const MERIDIAN_CHAIN = ['co-meridian-trade', 'co-halvorsen-holdings', 'co-corvane-investments', 'co-blue-lantern', 'per-viktor-halden'] as const
export const UBO = 'per-viktor-halden'
export const UBO_NAME = 'Viktor Halden'

/** 2. Sanctions-evasion front: director fuzzy-matches a listed person; shares an address with a listed company. */
export const FRONT_COMPANY = 'co-kestrel-bay'
export const FRONT_COMPANY_NAME = 'Kestrel Bay Trading Ltd'
export const FRONT_DIRECTOR = 'per-oleg-saranov'
export const FRONT_DIRECTOR_NAME = 'Oleg Saranov'
export const FRONT_ACCOUNT = 'acc-kestrel-gb'
export const LISTED_PARTY = 'co-volgamar-shipping'
export const SHARED_ADDRESS = 'addr-harrow-wharf'

/** 3. Money-mule ring: retail accounts sharing a device/address, structured deposits, one collector. */
export const MULE_ACCOUNTS = ['acc-mule-1', 'acc-mule-2', 'acc-mule-3', 'acc-mule-4', 'acc-mule-5'] as const
export const MULE_DEVICE = 'dev-mule-handset'
export const COLLECTOR = 'acc-collector'
export const COLLECTOR_HOLDER = 'co-brightwell-courier'

/** The 14 March 2026 wire from Kestrel Bay to the listed party's account. */
export const ALERTED_TXN = 'txn-kestrel-0314'

/** 4. Benign look-alikes: names resemble listed parties, but screening cleared them. */
export const BENIGN_LOOKALIKES = ['per-olga-saranova', 'co-northgate-petroleum', 'co-volgamar-seafoods'] as const
