export type FieldErrors = Readonly<Record<string, readonly string[]>>;

type AppErrorOptions = {
  code: string;
  fieldErrors?: FieldErrors;
  isOperational?: boolean;
  message: string;
  statusCode: number;
};

export class AppError extends Error {
  public readonly code: string;
  public readonly fieldErrors: FieldErrors | undefined;
  public readonly isOperational: boolean;
  public readonly statusCode: number;

  public constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = "AppError";
    this.code = options.code;
    this.fieldErrors = options.fieldErrors;
    this.isOperational = options.isOperational ?? true;
    this.statusCode = options.statusCode;
  }
}
