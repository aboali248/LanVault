import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/errors";
import { pageResponse, parsePagination } from "../../utils/pagination";
import {
  getDeviceProtection,
  listBackupFiles,
  listBackupTree,
  listDeletedFiles,
  listFileVersions,
  queueBackupFileRestore,
  queueDeletedFileRestore,
} from "../backups/backup-storage.service";
import { listBackupRows, deleteDeviceBackups } from "../backups/backup.service";

export const deviceBackupRouter = Router();
deviceBackupRouter.get("/:id/backups", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.id);
  const pagination = parsePagination(request);
  const result = listBackupRows({ deviceId, limit: pagination.pageSize, offset: pagination.offset });
  response.json(pageResponse(result.rows, result.total, pagination));
}));

deviceBackupRouter.delete("/:id/backups", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.id);
  response.json({ data: deleteDeviceBackups(deviceId) });
}));

deviceBackupRouter.get("/:id/protection", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.id);
  response.json({ data: getDeviceProtection(deviceId) });
}));

deviceBackupRouter.get("/:id/deleted-files", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.id);
  const pagination = parsePagination(request);
  const result = listDeletedFiles(deviceId, pagination.pageSize, pagination.offset);
  response.json(pageResponse(result.items, result.total, pagination));
}));

deviceBackupRouter.post("/:id/deleted-files/restore", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.id);
  const { fileIds } = z.object({
    fileIds: z.array(z.string().uuid()).min(1).max(100),
  }).strict().parse(request.body);
  const queued = queueDeletedFileRestore(deviceId, fileIds);
  response.status(202).json({ data: { queued } });
}));

const treeQuerySchema = z.object({
  drive: z.string().regex(/^[a-z]$/i).optional(),
  prefix: z.string().max(4096).optional(),
  // Pagination keys (page/pageSize) pass through to parsePagination below.
}).passthrough();

deviceBackupRouter.get("/:id/backups/:backupId/tree", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.id);
  const backupId = z.string().uuid().parse(request.params.backupId);
  const { drive, prefix } = treeQuerySchema.parse(request.query);
  const pagination = parsePagination(request, 100);
  const result = listBackupTree(deviceId, backupId, {
    drive,
    prefix,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });
  response.json({
    data: { drives: result.drives, directories: result.directories, files: result.files },
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.totalFiles,
      totalPages: Math.ceil(result.totalFiles / pagination.pageSize),
    },
  });
}));

const backupFilesQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  // Pagination keys (page/pageSize) pass through to parsePagination below.
}).passthrough();

deviceBackupRouter.get("/:id/backups/:backupId/files", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.id);
  const backupId = z.string().uuid().parse(request.params.backupId);
  const { search } = backupFilesQuerySchema.parse(request.query);
  const pagination = parsePagination(request, 100);
  const result = listBackupFiles(deviceId, backupId, {
    search,
    limit: pagination.pageSize,
    offset: pagination.offset,
  });
  response.json(pageResponse(result.items, result.total, pagination));
}));

const versionsQuerySchema = z.object({
  drive: z.string().regex(/^[a-z]$/i),
  path: z.string().trim().min(1).max(4096),
  // Pagination keys (page/pageSize) pass through to parsePagination below.
}).passthrough();
deviceBackupRouter.get("/:id/file-versions", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.id);
  const { drive, path: relativePath } = versionsQuerySchema.parse(request.query);
  const pagination = parsePagination(request, 100);
  const result = listFileVersions(deviceId, drive, relativePath, pagination.pageSize, pagination.offset);
  response.json(pageResponse(result.items, result.total, pagination));
}));

const restoreItemSchema = z.object({
  backupId: z.string().uuid(),
  drive: z.string().regex(/^[a-z]$/i),
  relativePath: z.string().trim().min(1).max(4096).optional(),
  prefix: z.string().max(4096).optional(),
}).strict().refine((item) => Boolean(item.relativePath) !== (item.prefix !== undefined), "Provide either relativePath or prefix");

deviceBackupRouter.post("/:id/backup-files/restore", asyncHandler((request, response) => {
  const deviceId = z.string().uuid().parse(request.params.id);
  const { items } = z.object({
    items: z.array(restoreItemSchema).min(1).max(100),
  }).strict().parse(request.body);
  const queued = queueBackupFileRestore(deviceId, items);
  response.status(202).json({ data: { queued } });
}));
