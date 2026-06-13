export type Batch = {
  program: string;
  year: number;
};

// The per-person fields extracted from one registration form.
// program_name + year are NOT here — they come from the batch context.
export type ExtractedFields = {
  first_name: string;
  last_name: string;
  dob: string;
  cell_phone: string;
  email: string;
  address: string;
};
