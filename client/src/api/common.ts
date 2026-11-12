// Shapes shared by several API resources.
export type Pagination = { page: number; limit: number; total: number; totalPages: number }
export type PatientSummary = { id: string; patientNumber: string; firstName: string; middleName: string | null; lastName: string }
export type StaffSummary = { id: string; staffNumber: string; firstName: string; lastName: string }
