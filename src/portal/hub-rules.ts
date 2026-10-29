import {isPhone} from '../lib/hub';
import {type Rule, rules} from '../lib/rules';

/**
 * The hub forms' rules: the SAME limits and words as the Site API's readers
 * (src/server/hub/input.ts, src/server/routes/cases.ts). The server checks
 * again; its field errors land on the same fields.
 */
const phone: Rule = value => (!value.trim() || isPhone(value) ? null : 'Enter a 10-digit phone number, like (718) 555-1234.');
const year =
  (min: number, max: number, message: string): Rule =>
  value =>
    !value.trim() || (/^\d{4}$/.test(value.trim()) && Number(value) >= min && Number(value) <= max) ? null : message;
const thisYear = new Date().getFullYear();

export const HOT_RULES = {
  customerName: [rules.required("Enter the customer's name."), rules.maxLength(80)],
  phone: [rules.required("Enter the customer's mobile number."), phone],
  customerEmail: [rules.email('Enter a valid email, like name@example.com.'), rules.maxLength(254)],
  storeId: [rules.required('Pick the store.')],
  source: [rules.required('Pick where the customer came from.')],
  reason: [rules.required('Pick why a manager is needed.')],
  customerWords: [
    rules.required('Write what the customer said (up to 300 characters).'),
    rules.maxLength(300, 'Use at most 300 characters.'),
  ],
  urgency: [rules.required('Pick how urgent this is.')],
  vehicleYear: [year(1980, thisYear + 2, 'Enter a 4-digit year, like 2025.')],
  vehicleMake: [rules.maxLength(40)],
  vehicleModel: [rules.maxLength(60)],
  stockNumber: [rules.maxLength(20)],
};

export const TRADE_RULES = {
  tradeYear: [year(1950, thisYear + 1, 'Enter a 4-digit year, like 2019.')],
  tradeMake: [rules.required('Enter the trade-in make.'), rules.maxLength(40)],
  tradeModel: [rules.required('Enter the trade-in model.'), rules.maxLength(60)],
  tradeMiles: [rules.wholeNumber('Enter the miles as a whole number, like 45000.')],
};

export const CALLBACK_RULES = {
  callbackAt: [rules.required('Pick the callback date and time.')],
};

export const CSI_RULES = {
  storeId: [rules.required('Pick the store.')],
  department: [rules.required('Pick sales delivery or service visit.')],
  customerName: [rules.required("Enter the customer's name."), rules.maxLength(80)],
  phone: [rules.required("Enter the customer's mobile number."), phone],
  customerEmail: [rules.email('Enter a valid email, like name@example.com.'), rules.maxLength(254)],
  refNumber: [rules.maxLength(20)],
  stage: [rules.required('Pick the stage.')],
  sentiment: [rules.required('Pick how the customer felt.')],
  surveyScore: [rules.maxLength(20)],
  customerWords: [
    rules.required("Write the customer's words (up to 300 characters)."),
    rules.maxLength(300, 'Use at most 300 characters.'),
  ],
};

export const PROBLEMS_RULE = {problems: [rules.required('Pick at least one thing that went wrong.')]};

export {rules};
