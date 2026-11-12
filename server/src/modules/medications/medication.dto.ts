export type MedicationRow = { id: string; name: string; active: boolean; createdAt: Date; updatedAt: Date }

// Catalog entries are names only: no prescription, patient or usage data is ever attached.
export function toMedication(value: MedicationRow) {
  return { id: value.id, name: value.name, active: value.active, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }
}
export const toMedicationOption = (value: Pick<MedicationRow, 'id' | 'name'>) => ({ id: value.id, name: value.name })
