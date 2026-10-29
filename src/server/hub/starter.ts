/**
 * The starter staff list from the build prompt (section 14), loaded ONCE by
 * the admin from People → "Load the starter list" (never by a migration).
 * Reps, salespeople, advisors and CSI reps come later from the CSV (Phase 4).
 *
 * Emails follow "first name + last initial @plazacars.com", except the
 * addresses the owner corrected (`CORRECTED_EMAILS`). The rest are a guess
 * until checked against the CSV.
 */
export interface StarterPerson {
  firstName: string;
  lastName: string;
  roles: string[];
  /** Store short names (`Honda`, `Used Cars`); none = a group-level person. */
  stores: string[];
  department: 'sales' | 'service' | 'group';
  /** First name + last name of their manager in this list. */
  manager?: string;
}

const sales = (stores: string, names: string[]): StarterPerson[] =>
  names.map(n => {
    const [firstName, ...rest] = n.split(' ');
    return {firstName: firstName!, lastName: rest.join(' '), roles: ['sales-manager'], stores: [stores], department: 'sales'};
  });
const service = (stores: string, names: string[]): StarterPerson[] =>
  names.map(n => {
    const [firstName, ...rest] = n.split(' ');
    return {firstName: firstName!, lastName: rest.join(' '), roles: ['service-manager'], stores: [stores], department: 'service'};
  });

export const STARTER_PEOPLE: StarterPerson[] = [
  {firstName: 'Adam', lastName: 'Rosatti', roles: ['executive'], stores: [], department: 'group'},
  {firstName: 'Unice', lastName: 'Bailey', roles: ['director-ops'], stores: [], department: 'group'},
  {firstName: 'Amy', lastName: 'Kendall', roles: ['bdc-director', 'bdc-manager'], stores: [], department: 'group'},
  {
    firstName: 'Michael',
    lastName: 'Ostrow',
    roles: ['bdc-manager'],
    stores: ['Honda', 'Hyundai', 'Acura'],
    department: 'group',
    manager: 'Amy Kendall',
  },
  {
    firstName: 'Chastity',
    lastName: 'Brigantti',
    roles: ['bdc-manager'],
    stores: ['Toyota', 'Kia'],
    department: 'group',
    manager: 'Amy Kendall',
  },
  {firstName: 'Alexzandra', lastName: '', roles: ['service-bdc-manager'], stores: [], department: 'group'},
  ...sales('Honda', ['Saad Miraz', 'Zohaib Raja', 'Sean Robinson']),
  ...sales('Toyota', ['Jose Valerio', 'Angel Sanchez', 'Mohammed Bouzerd']),
  ...sales('Acura', ['Kevin Crespo', 'Santiago Hernandez']),
  ...sales('Kia', ['Louis Maginn', 'Thomas McAvoy', 'Brian Abreu', 'Michael Delgado']),
  ...sales('Hyundai', ['Brian Carrol', 'Manuel Perez', 'Dominic Jimenez']),
  ...sales('Used Cars', ['Ornan Corcino', 'Wilson Mateo', 'Emile Salifiti']),
  ...service('Honda', ['Rod Eddy', 'Chris Ruscio', 'Kenny Surjy']),
  ...service('Toyota', ['Michael Ramos', 'Nelson Morales']),
  ...service('Hyundai', ['Anthony Austin']),
  ...service('Acura', ['Carl Nimmons']),
  ...service('Kia', ['Luigi Vitale']),
];

/** The real addresses the owner gave, by full name: they win over the guess. */
export const CORRECTED_EMAILS: Record<string, string> = {
  'Unice Bailey': 'uniceb@plazacars.com',
  'Adam Rosatti': 'adam@plazacars.com',
  Alexzandra: 'alexzandras@plazacars.com',
  'Angel Sanchez': 'angel@plazacars.com',
  'Mohammed Bouzerd': 'mohamedb2@plazacars.com',
  'Kevin Crespo': 'kevincr@plazacars.com',
  'Santiago Hernandez': 'santiago@plazacars.com',
  'Brian Abreu': 'brianta@plazacars.com',
  'Dominic Jimenez': 'dominic@plazacars.com',
  'Wilson Mateo': 'wilson@plazacars.com',
  'Rod Eddy': 'rod@plazacars.com',
  'Chris Ruscio': 'christopherr@plazacars.com',
  'Michael Ramos': 'michaelra@plazacars.com',
};

/** `Rod Eddy` → `rod@plazacars.com` (corrected); otherwise `Saad Miraz` → `saadm@plazacars.com`. */
export const starterEmail = (p: Pick<StarterPerson, 'firstName' | 'lastName'>) =>
  CORRECTED_EMAILS[`${p.firstName} ${p.lastName}`.trim()] ??
  `${p.firstName}${p.lastName.slice(0, 1)}`.toLowerCase().replace(/[^a-z0-9]/g, '') + '@plazacars.com';

/**
 * Default routing from the list: BDC cases to the store's BDC manager (Amy
 * Kendall where none is named), salesperson and sales-delivery CSI cases to
 * the store's first sales manager, service CSI cases to its first service
 * manager. Only fills routes that are still empty.
 */
export const STARTER_ROUTES: {store: string; kind: string; person: string}[] = [
  ...['Acura', 'Honda', 'Hyundai'].map(store => ({store, kind: 'hot_bdc', person: 'Michael Ostrow'})),
  ...['Kia', 'Toyota'].map(store => ({store, kind: 'hot_bdc', person: 'Chastity Brigantti'})),
  {store: 'Used Cars', kind: 'hot_bdc', person: 'Amy Kendall'},
  ...(
    [
      ['Acura', 'Kevin Crespo', 'Carl Nimmons'],
      ['Honda', 'Saad Miraz', 'Rod Eddy'],
      ['Hyundai', 'Brian Carrol', 'Anthony Austin'],
      ['Kia', 'Louis Maginn', 'Luigi Vitale'],
      ['Toyota', 'Jose Valerio', 'Michael Ramos'],
      ['Used Cars', 'Ornan Corcino', null],
    ] as const
  ).flatMap(([store, salesManager, serviceManager]) => [
    {store, kind: 'hot_sales', person: salesManager},
    {store, kind: 'csi_sales', person: salesManager},
    ...(serviceManager ? [{store, kind: 'csi_service', person: serviceManager}] : []),
  ]),
];
