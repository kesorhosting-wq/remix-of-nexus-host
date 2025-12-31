// Simple validation utilities for Edge Functions
// Using basic validation instead of external Zod dependency for reliability

export class ValidationError extends Error {
  constructor(message: string, public details: string[] = []) {
    super(message);
    this.name = "ValidationError";
  }
}

export function validateUUID(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new ValidationError(`${fieldName} must be a valid UUID`);
  }
  
  return value;
}

export function validateEmail(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    throw new ValidationError(`${fieldName} must be a valid email address`);
  }
  
  if (value.length > 255) {
    throw new ValidationError(`${fieldName} must be less than 255 characters`);
  }
  
  return value;
}

export function validateString(
  value: unknown, 
  fieldName: string, 
  options: { minLength?: number; maxLength?: number; required?: boolean } = {}
): string {
  const { minLength = 0, maxLength = 10000, required = true } = options;
  
  if (value === undefined || value === null) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return "";
  }
  
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  
  if (value.length < minLength) {
    throw new ValidationError(`${fieldName} must be at least ${minLength} characters`);
  }
  
  if (value.length > maxLength) {
    throw new ValidationError(`${fieldName} must be at most ${maxLength} characters`);
  }
  
  return value;
}

export function validateNumber(
  value: unknown, 
  fieldName: string,
  options: { min?: number; max?: number; required?: boolean } = {}
): number {
  const { min, max, required = true } = options;
  
  if (value === undefined || value === null) {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return 0;
  }
  
  const num = typeof value === "string" ? parseFloat(value) : value;
  
  if (typeof num !== "number" || isNaN(num)) {
    throw new ValidationError(`${fieldName} must be a valid number`);
  }
  
  if (min !== undefined && num < min) {
    throw new ValidationError(`${fieldName} must be at least ${min}`);
  }
  
  if (max !== undefined && num > max) {
    throw new ValidationError(`${fieldName} must be at most ${max}`);
  }
  
  return num;
}

export function validateEnum<T extends string>(
  value: unknown, 
  fieldName: string, 
  allowedValues: readonly T[]
): T {
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  
  if (!allowedValues.includes(value as T)) {
    throw new ValidationError(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }
  
  return value as T;
}

export function validateArray<T>(
  value: unknown,
  fieldName: string,
  itemValidator: (item: unknown, index: number) => T,
  options: { minLength?: number; maxLength?: number } = {}
): T[] {
  const { minLength = 0, maxLength = 100 } = options;
  
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }
  
  if (value.length < minLength) {
    throw new ValidationError(`${fieldName} must have at least ${minLength} items`);
  }
  
  if (value.length > maxLength) {
    throw new ValidationError(`${fieldName} must have at most ${maxLength} items`);
  }
  
  return value.map((item, index) => itemValidator(item, index));
}

export function validateObject(
  value: unknown, 
  fieldName: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an object`);
  }
  
  return value as Record<string, unknown>;
}

export function validateUrl(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldName} must be a string`);
  }
  
  try {
    new URL(value);
  } catch {
    throw new ValidationError(`${fieldName} must be a valid URL`);
  }
  
  if (value.length > 2048) {
    throw new ValidationError(`${fieldName} must be at most 2048 characters`);
  }
  
  return value;
}

export function sanitizeString(value: string): string {
  // Remove any HTML tags and trim whitespace
  return value
    .replace(/<[^>]*>/g, "")
    .trim();
}
