import { maskPhone } from "./phone";

/** Masks the joined contact phone on leads and requirements for roles without `contact.view_phone`. */
export function redactContactPhone<T extends { contactPhone: string }>(item: T, canViewPhone: boolean): T {
  return canViewPhone ? item : { ...item, contactPhone: maskPhone(item.contactPhone) };
}
