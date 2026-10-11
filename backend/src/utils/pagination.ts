import type { Request } from "express";
import { AppError } from "./errors";

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePagination(request: Request, maxPageSize = 100): Pagination {
  const pageRaw = request.query.page ?? "1";
  const pageSizeRaw = request.query.pageSize ?? "20";
  const page = Number.parseInt(String(pageRaw), 10);
  const pageSize = Number.parseInt(String(pageSizeRaw), 10);

  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maxPageSize) {
    throw new AppError(400, `page must be >= 1 and pageSize must be between 1 and ${maxPageSize}`);
  }

  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageResponse<T>(data: T[], total: number, pagination: Pagination) {
  return {
    data,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    },
  };
}
