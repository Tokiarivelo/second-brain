# Backend Full Review — Second Brain

> Generated: 2026-06-10  
> Stack: **NestJS 11** · **Prisma 6** · **PostgreSQL** · **JWT + bcrypt** · **Multer**

---

## Table of Contents

1. [Critical Security Issues](#1-critical-security-issues)
2. [Architecture & Design Issues](#2-architecture--design-issues)
3. [Missing Features / Incomplete Code](#3-missing-features--incomplete-code)
4. [Code Quality & Maintainability](#4-code-quality--maintainability)
5. [Database & Schema Issues](#5-database--schema-issues)
6. [Testing Issues](#6-testing-issues)
7. [Infrastructure / DevOps Issues](#7-infrastructure--devops-issues)
8. [Summary Table](#8-summary-table)

---

## 1. Critical Security Issues

### 1.1 Hardcoded JWT Secret

**File:** `src/auth/auth.module.ts` — line 17

**Problem:** The JWT signing secret is a hard-coded string in source code. Anyone who reads the code (public repo, leaked backup, insider) can forge valid tokens for any user.

```typescript
// ❌ CURRENT — secret is visible in source code
JwtModule.register({
  secret: 'mon-secret-jwt',
  signOptions: { expiresIn: '1d' },
})
```

**Fix:** Load the secret from an environment variable and validate that it is set at startup.

```typescript
// ✅ CORRECT
import { ConfigModule, ConfigService } from '@nestjs/config';

JwtModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.getOrThrow<string>('JWT_SECRET'),
    signOptions: { expiresIn: '15m' },
  }),
}),
```

And in `.env`:
```
JWT_SECRET=a-very-long-random-secret-generated-with-openssl-rand-base64-64
```

---

### 1.2 No Input Validation (DTO / Class-Validator)

**Files:** `src/auth/auth.controller.ts`, `src/documents/documents.controller.ts`

**Problem:** Every controller parameter is typed as `any`. There is no `ValidationPipe`, no DTO classes, and no `class-validator` decorators. This means:
- A request with `{ "email": null, "password": 123 }` will reach the database.
- SQL/NoSQL injection payloads pass through unchecked.
- A missing field causes a cryptic Prisma/DB error instead of a `400 Bad Request`.

```typescript
// ❌ CURRENT — no validation whatsoever
@Post('register')
register(@Body() body: any) {
  return this.authService.register(body.email, body.password, body.name);
}
```

**Fix:** Create DTO classes and enable the global `ValidationPipe`.

```typescript
// src/auth/dto/register.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @MinLength(2)
  name: string;
}
```

```typescript
// src/auth/auth.controller.ts ✅
import { RegisterDto } from './dto/register.dto';

@Post('register')
register(@Body() body: RegisterDto) {
  return this.authService.register(body.email, body.password, body.name);
}
```

```typescript
// src/main.ts ✅ — enable globally
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(process.env.PORT ?? 3000);
}
```

---

### 1.3 Upload Endpoint Has No Authentication Guard

**File:** `src/documents/documents.controller.ts`

**Problem:** Anyone on the internet can call `POST /documents/upload` and store arbitrary PDFs on the server without being logged in.

```typescript
// ❌ CURRENT — no guard, public to the world
@Post('upload')
@UseInterceptors(FileInterceptor('file', { ... }))
uploadPdf(@UploadedFile() file: Express.Multer.File) { ... }
```

**Fix:** Create a `JwtAuthGuard` (currently missing despite `passport-jwt` being installed) and apply it.

```typescript
// src/auth/guards/jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

```typescript
// src/auth/strategies/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }

  validate(payload: { sub: number; email: string }) {
    return { userId: payload.sub, email: payload.email };
  }
}
```

```typescript
// src/documents/documents.controller.ts ✅
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Post('upload')
@UseGuards(JwtAuthGuard)           // ← add this
@UseInterceptors(FileInterceptor('file', { ... }))
uploadPdf(@UploadedFile() file: Express.Multer.File) { ... }
```

---

### 1.4 Refresh Token Is Never Invalidated (Replay Attack)

**File:** `src/auth/auth.service.ts` — `refresh()` method

**Problem:** When a client calls `/auth/refresh`, the old refresh token is looked up and a new access token is returned — but the refresh token is **never deleted**. An attacker who steals a refresh token can keep using it forever, even after the legitimate user has refreshed.

```typescript
// ❌ CURRENT — token reused indefinitely
async refresh(refreshToken: string) {
  const storedToken = await this.refreshTokenService.find(refreshToken);
  // ... checks ...
  // ❌ old token stays in the database
  return { access_token: accessToken };
}
```

**Fix:** Delete the old token and issue a new one (token rotation).

```typescript
// ✅ CORRECT — token rotation
async refresh(refreshToken: string) {
  const storedToken = await this.refreshTokenService.find(refreshToken);

  if (!storedToken || storedToken.expiresAt < new Date()) {
    throw new UnauthorizedException('Invalid or expired refresh token');
  }

  // Invalidate the used token immediately
  await this.refreshTokenService.delete(refreshToken);

  const payload = this.jwtService.verify(refreshToken);

  const newAccessToken = this.jwtService.sign(
    { sub: payload.sub, email: payload.email },
    { expiresIn: '15m' },
  );

  const newRefreshToken = this.jwtService.sign(
    { sub: payload.sub },
    { expiresIn: '7d' },
  );

  await this.refreshTokenService.create(
    payload.sub,
    newRefreshToken,
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  );

  return { access_token: newAccessToken, refresh_token: newRefreshToken };
}
```

---

### 1.5 Duplicate Email Registration Leaks a Raw Prisma Error

**File:** `src/auth/auth.service.ts` — `register()`, `src/users/users.service.ts`

**Problem:** If a user tries to register with an email that already exists, Prisma throws an unhandled `PrismaClientKnownRequestError` with code `P2002`. This exception propagates to the client as a `500 Internal Server Error` with a full stack trace, leaking database internals.

```
// ❌ Raw Prisma error sent to client:
PrismaClientKnownRequestError: Unique constraint failed on the fields: (`email`)
```

**Fix:** Catch the Prisma error and convert it to a meaningful HTTP response.

```typescript
// src/users/users.service.ts ✅
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

async create(email: string, passwordHash: string, name: string) {
  try {
    return await this.prisma.user.create({ data: { email, passwordHash, name } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException('Email already in use');
    }
    throw e;
  }
}
```

---

### 1.6 `jwtService.verify()` Can Throw Unhandled Exception in `refresh()`

**File:** `src/auth/auth.service.ts` — line 106

**Problem:** `this.jwtService.verify(refreshToken)` throws a `JsonWebTokenError` or `TokenExpiredError` if the token is invalid or expired. This call is not wrapped in a try/catch, so it produces an unformatted `500` error.

```typescript
// ❌ CURRENT — unhandled exception
const payload = this.jwtService.verify(refreshToken);
```

**Fix:** Wrap in try/catch:

```typescript
// ✅ CORRECT
let payload: { sub: number };
try {
  payload = this.jwtService.verify(refreshToken);
} catch {
  throw new UnauthorizedException('Invalid refresh token');
}
```

---

### 1.7 No CORS Configuration

**File:** `src/main.ts`

**Problem:** No CORS headers are set. Depending on the deployment, browsers may be blocked from calling the API, or (worse) the API might be open to all origins.

**Fix:**

```typescript
// src/main.ts ✅
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(process.env.PORT ?? 3000);
}
```

---

### 1.8 No Rate Limiting on Auth Endpoints

**Problem:** `/auth/login`, `/auth/register`, and `/auth/refresh` have no rate limiting. An attacker can run unlimited brute-force password attempts.

**Fix:** Add `@nestjs/throttler`.

```bash
npm install @nestjs/throttler
```

```typescript
// src/app.module.ts ✅
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]), // 10 requests / minute
    // ...
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

---

## 2. Architecture & Design Issues

### 2.1 `index.js` Is a Redundant Parallel Server

**File:** `index.js`, `package.json`

**Problem:** `index.js` is a completely separate raw Express application that runs on the same port (3000) as the NestJS app. The `package.json` `"dev"` script runs this file instead of NestJS. This means:
- `npm run dev` starts a bare Express app with no authentication, not the real NestJS backend.
- Two different servers exist for the same project with conflicting behavior.
- New developers are likely to test against the wrong server.

```javascript
// index.js — completely bypasses NestJS, auth, and all business logic
const app = express();
app.get('/', async (req, res) => { ... });
app.listen(3000, ...);
```

**Fix:** Delete `index.js` and update `package.json`:

```json
// package.json ✅
"scripts": {
  "dev": "nest start --watch",
  "start:prod": "node dist/main"
}
```

---

### 2.2 `DocumentsService` Is Completely Empty

**File:** `src/documents/documents.service.ts`

**Problem:** The service was scaffolded but never implemented. All upload logic lives directly in the controller (bad practice). Nothing is ever saved to the `documents` database table.

```typescript
// ❌ CURRENT — empty service
@Injectable()
export class DocumentsService {}
```

**Fix:** Move file logic to the service and persist to the database.

```typescript
// src/documents/documents.service.ts ✅
@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async saveDocument(userId: number, file: Express.Multer.File): Promise<Document> {
    return this.prisma.document.create({
      data: {
        userId,
        title: file.originalname,
        filePath: file.path,
        fileSize: file.size,
        status: 'uploaded',
      },
    });
  }

  async findAllByUser(userId: number) {
    return this.prisma.document.findMany({ where: { userId } });
  }

  async findOne(id: number, userId: number) {
    return this.prisma.document.findFirst({ where: { id, userId } });
  }

  async remove(id: number, userId: number) {
    return this.prisma.document.delete({ where: { id, userId } });
  }
}
```

---

### 2.3 `JwtStrategy` / `JwtAuthGuard` Are Missing

**Problem:** `passport`, `passport-jwt`, and `@nestjs/passport` are installed but **no strategy or guard is implemented**. JWT protection cannot be applied to any route.

**Fix:** See fix in [§1.3](#13-upload-endpoint-has-no-authentication-guard). Also register `JwtStrategy` in `AuthModule`:

```typescript
// src/auth/auth.module.ts ✅
providers: [AuthService, RefreshTokenService, JwtStrategy],
exports: [JwtAuthGuard],
```

---

### 2.4 `AppController` / `AppService` Are Boilerplate That Should Be Removed or Replaced

**Files:** `src/app.controller.ts`, `src/app.service.ts`

**Problem:** The default NestJS scaffolding `GET /` returning `"Hello World!"` is still present. This is not useful in production and wastes a route.

**Fix:** Replace with a health-check endpoint:

```typescript
// src/app.controller.ts ✅
@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

---

### 2.5 `PrismaService` Never Disconnects

**File:** `src/prisma/prisma.service.ts`

**Problem:** `onModuleInit` connects to the database, but there is no `onModuleDestroy` hook to call `$disconnect()`. This can leave dangling connections during graceful shutdown or testing.

```typescript
// ❌ CURRENT — no disconnect
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() { await this.$connect(); }
}
```

**Fix:**

```typescript
// src/prisma/prisma.service.ts ✅
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

---

### 2.6 Confusing Parameter Name in `login()`

**File:** `src/auth/auth.service.ts` — line 34

**Problem:** The `login` method parameter is named `passwordHash` but it actually receives the **plain-text password** sent by the client. This is misleading to anyone reading the code.

```typescript
// ❌ CURRENT — the name says "hash" but it's the raw password
async login(email: string, passwordHash: string) {
  const match = await bcrypt.compare(passwordHash, user.passwordHash);
```

**Fix:**

```typescript
// ✅ CORRECT
async login(email: string, password: string) {
  const match = await bcrypt.compare(password, user.passwordHash);
```

---

## 3. Missing Features / Incomplete Code

### 3.1 No CRUD Endpoints for Documents

The `documents` table exists in the schema but the API only exposes `POST /documents/upload`. There is no way to:
- List a user's documents
- Get a single document
- Delete a document

**Suggested endpoints to add:**

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/documents` | List authenticated user's documents |
| `GET` | `/documents/:id` | Get a single document |
| `DELETE` | `/documents/:id` | Delete a document |

---

### 3.2 No Chat / RAG Functionality

The schema defines `ChatSession` and `ChatMessage` models, and `DocumentChunk` has an `embeddingId` field — clearly intending a RAG (Retrieval-Augmented Generation) pipeline. None of this is implemented in the backend code.

**Missing:**
- PDF text extraction service
- Document chunking service
- Embedding generation (calls to an AI API)
- Vector search (pgvector or external service)
- Chat session controller/service
- LLM call integration

---

### 3.3 No Logout Endpoint

There is no `POST /auth/logout` that deletes the refresh token from the database, meaning a "logged out" user's refresh token remains valid until it naturally expires in 7 days.

```typescript
// src/auth/auth.controller.ts — add:
@Post('logout')
@UseGuards(JwtAuthGuard)
async logout(@Body() body: { refreshToken: string }) {
  await this.authService.logout(body.refreshToken);
  return { message: 'Logged out successfully' };
}

// src/auth/auth.service.ts — add:
async logout(refreshToken: string) {
  await this.refreshTokenService.delete(refreshToken);
}
```

---

### 3.4 Uploaded Files Are Not Linked to Database Records

**File:** `src/documents/documents.controller.ts`

When a file is uploaded, its path and metadata are returned in the response but **never persisted to the `documents` table**. The database and the file system are out of sync.

**Fix:** Call `DocumentsService.saveDocument()` from the controller (see fix in [§2.2](#22-documentsservice-is-completely-empty)).

---

### 3.5 No Swagger / API Documentation

There is no `@nestjs/swagger` integration. Developers have no in-browser way to explore or test the API.

```bash
npm install @nestjs/swagger
```

```typescript
// src/main.ts ✅
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('Second Brain API')
  .setVersion('1.0')
  .addBearerAuth()
  .build();
const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api', app, document);
```

---

## 4. Code Quality & Maintainability

### 4.1 No `.env` / Environment Configuration Module

**Problem:** There is no `.env.example`, no `@nestjs/config`, and environment variables are read ad-hoc with `process.env`. If a required variable is missing, the app silently uses `undefined`.

**Fix:** Add `@nestjs/config` and validate the environment at startup.

```bash
npm install @nestjs/config
```

```typescript
// src/app.module.ts ✅
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    // ...
  ],
})
```

Add a `.env.example` file at the repo root:

```
DATABASE_URL=******localhost:5433/second_brain
JWT_SECRET=change-me-to-a-long-random-string
PORT=3000
CORS_ORIGIN=http://localhost:5173
```

---

### 4.2 Hardcoded Upload Destination Path

**File:** `src/documents/documents.controller.ts` — line 22

```typescript
// ❌ CURRENT — hardcoded relative path
destination: './uploads',
```

A relative path can point to different directories depending on where the process is started. Use an absolute path from an env variable.

```typescript
// ✅ CORRECT
import { join } from 'path';

destination: process.env.UPLOAD_PATH ?? join(process.cwd(), 'uploads'),
```

---

### 4.3 Comments Are in French, Code Is in English

**Files:** `src/documents/documents.controller.ts`

The code uses English identifiers but inline comments are in French. This inconsistency hinders collaboration with non-French speakers.

```typescript
// ❌ CURRENT
// Limite la taille à 20 Mo
// Vérifie que le type MIME est obligatoirement un PDF
// Si la validation réussit, le fichier est enregistré
```

**Fix:** Write all comments in English (or remove them if they simply restate what the code does).

---

### 4.4 `RefreshToken.token` Has No Unique Index

**File:** `prisma/schema.prisma` — `RefreshToken` model

**Problem:** The `token` field is not `@unique`, so the database does not enforce uniqueness. The `find()` method uses `findFirst` which picks an arbitrary match if duplicates exist.

```prisma
// ❌ CURRENT — no uniqueness constraint
model RefreshToken {
  token  String
}
```

**Fix:**

```prisma
// ✅ CORRECT
model RefreshToken {
  token  String  @unique
}
```

---

### 4.5 `Document.status` and `ChatMessage.role` Should Use Enums

**File:** `prisma/schema.prisma`

Using plain `String` for fields with a fixed set of values loses compile-time safety and makes it easy to store invalid states.

```prisma
// ❌ CURRENT
model Document { status String }
model ChatMessage { role String }
```

**Fix:**

```prisma
// ✅ CORRECT
enum DocumentStatus {
  UPLOADED
  PROCESSING
  READY
  ERROR
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
}

model Document  { status DocumentStatus }
model ChatMessage { role MessageRole }
```

---

## 5. Database & Schema Issues

### 5.1 No Cascade Deletes

**File:** `prisma/schema.prisma`

All foreign-key relations use the default `onDelete: Restrict`. This means you cannot delete a `User` while they have documents, chat sessions, or refresh tokens — you must manually delete children first.

```prisma
// ❌ CURRENT — deleting a user with documents will throw an error
user User @relation(fields: [userId], references: [id])
```

**Fix:** Add cascade deletes where logical.

```prisma
// ✅ CORRECT
model Document {
  user  User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model RefreshToken {
  user  User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model ChatSession {
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  document  Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
}
model ChatMessage {
  session ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
}
model DocumentChunk {
  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
}
```

---

### 5.2 Second Migration Drops and Recreates the Entire `users` Table

**File:** `prisma/migrations/20260604072520_init/migration.sql`

```sql
-- ⚠️ ALL DATA IN users IS LOST
DROP TABLE "User";
CREATE TABLE "users" (...);
```

This happened because the initial migration used mixed-case `"User"` and the schema was later updated to use the proper `@@map("users")`. In production, this would be a data-loss incident.

**Fix:** Always use incremental migration names (not `_init` for every migration) and preview with `prisma migrate dev --name describe_change`. Never rename a migration to `_init` after the first one.

---

### 5.3 No Database Indexes on Foreign Keys

The migration SQL creates foreign-key constraints but no indexes on the foreign key columns (`user_id`, `document_id`, `session_id`). This causes full table scans when joining or querying by these columns.

```sql
-- ❌ CURRENT — no index on user_id
ALTER TABLE "documents" ADD CONSTRAINT ... FOREIGN KEY ("user_id") REFERENCES "users"("id");
```

**Fix in Prisma schema:**

```prisma
model Document {
  userId Int @map("user_id")
  @@index([userId])
}
```

---

## 6. Testing Issues

### 6.1 All Tests Are Placeholder Stubs

Every `*.spec.ts` file contains only a single `toBeDefined()` assertion. There is **zero functional test coverage**.

```typescript
// ❌ CURRENT — all spec files look like this
it('should be defined', () => {
  expect(service).toBeDefined();
});
```

**Minimum tests needed:**

| File | Tests to write |
|------|----------------|
| `auth.service.spec.ts` | `register()` hashes password, `login()` returns tokens, `login()` throws on wrong password, `refresh()` rotates tokens |
| `auth.controller.spec.ts` | `POST /auth/register` returns 201, `POST /auth/login` returns 200 with tokens |
| `users.service.spec.ts` | `findByEmail()` returns user or null, `create()` throws `ConflictException` on duplicate |
| `documents.service.spec.ts` | `saveDocument()` persists record, `findAllByUser()` filters by user |
| `refresh-token.service.spec.ts` | `create()`, `find()`, `delete()` work correctly |

Example:

```typescript
// src/auth/auth.service.spec.ts ✅
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { RefreshTokenService } from './refresh-token/refresh-token.service';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), create: jest.fn() } as any;
    const jwtService = { sign: jest.fn().mockReturnValue('token'), verify: jest.fn() } as any;
    const refreshTokenService = { create: jest.fn(), find: jest.fn(), delete: jest.fn() } as any;
    service = new AuthService(usersService, jwtService, refreshTokenService);
  });

  it('throws UnauthorizedException for unknown email', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    await expect(service.login('a@b.com', 'pass')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException for wrong password', async () => {
    const hash = await bcrypt.hash('correct', 12);
    usersService.findByEmail.mockResolvedValue({ id: 1, email: 'a@b.com', passwordHash: hash } as any);
    await expect(service.login('a@b.com', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

---

### 6.2 `AuthService.spec.ts` and `UsersService.spec.ts` Will Fail Without Mocks

The test modules try to instantiate services without providing their dependencies (`JwtService`, `UsersService`, `PrismaService`). These tests will throw `Nest can't resolve dependencies` errors when run.

---

## 7. Infrastructure / DevOps Issues

### 7.1 Database Password Is Hard-Coded in `docker-compose.yml`

**File:** `docker-compose.yml`

```yaml
# ❌ CURRENT — password committed to source control
environment:
  - POSTGRES_PASSWORD=twisteromega
```

**Fix:** Use a `.env` file for compose:

```yaml
# docker-compose.yml ✅
environment:
  - POSTGRES_DB=${POSTGRES_DB}
  - POSTGRES_USER=${POSTGRES_USER}
  - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
```

```
# .env (gitignored)
POSTGRES_DB=second_brain
POSTGRES_USER=postgres
POSTGRES_PASSWORD=a-secure-password
DATABASE_URL=******localhost:5433/second_brain
```

---

### 7.2 No `.env.example` File

New developers have no reference for which environment variables are required. The app will silently fail or behave incorrectly if variables are missing.

**Fix:** Create `.env.example` (committed to git) and add `.env` to `.gitignore`.

---

### 7.3 No Security Headers (Helmet)

There is no `helmet` middleware, so HTTP responses lack important security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`, etc.).

```bash
npm install helmet
```

```typescript
// src/main.ts ✅
import helmet from 'helmet';

const app = await NestFactory.create(AppModule);
app.use(helmet());
```

---

### 7.4 Uploaded Files Stored on Local Disk With No Cleanup

`./uploads` is a relative directory on the server's local filesystem. Issues:
- Files are never deleted when a document record is removed.
- Doesn't work if the app is scaled horizontally (multiple instances).
- No protection against path traversal in `file.filename`.

**Fix:** Use cloud object storage (AWS S3, Cloudflare R2, etc.) via `@aws-sdk/client-s3` or a similar SDK for production environments.

---

## 8. Summary Table

| # | Issue | Severity | File(s) |
|---|-------|----------|---------|
| 1.1 | Hardcoded JWT secret | 🔴 Critical | `auth.module.ts` |
| 1.2 | No input validation (DTOs) | 🔴 Critical | `auth.controller.ts` |
| 1.3 | Upload route unprotected | 🔴 Critical | `documents.controller.ts` |
| 1.4 | Refresh tokens never invalidated | 🔴 Critical | `auth.service.ts` |
| 1.5 | Duplicate email leaks Prisma error | 🟠 High | `users.service.ts` |
| 1.6 | `jwtService.verify()` unhandled exception | 🟠 High | `auth.service.ts` |
| 1.7 | No CORS configuration | 🟠 High | `main.ts` |
| 1.8 | No rate limiting | 🟠 High | `auth.controller.ts` |
| 2.1 | `index.js` is a rogue parallel server | 🟠 High | `index.js` |
| 2.2 | `DocumentsService` is empty | 🟠 High | `documents.service.ts` |
| 2.3 | `JwtStrategy`/`JwtAuthGuard` missing | 🟠 High | `auth/` |
| 2.4 | `AppController` is boilerplate | 🟡 Medium | `app.controller.ts` |
| 2.5 | Prisma never disconnects | 🟡 Medium | `prisma.service.ts` |
| 2.6 | Misleading parameter name `passwordHash` | 🟡 Medium | `auth.service.ts` |
| 3.1 | No CRUD endpoints for documents | 🟡 Medium | `documents/` |
| 3.2 | No chat/RAG implementation | 🟡 Medium | — |
| 3.3 | No logout endpoint | 🟡 Medium | `auth.controller.ts` |
| 3.4 | Uploaded files not saved to DB | 🟠 High | `documents.controller.ts` |
| 3.5 | No Swagger documentation | 🟡 Medium | `main.ts` |
| 4.1 | No `@nestjs/config` / `.env` validation | 🟡 Medium | `app.module.ts` |
| 4.2 | Hardcoded upload path | 🟡 Medium | `documents.controller.ts` |
| 4.3 | French comments in English codebase | 🟢 Low | `documents.controller.ts` |
| 4.4 | `RefreshToken.token` not unique in DB | 🟠 High | `schema.prisma` |
| 4.5 | `status`/`role` fields should be enums | 🟡 Medium | `schema.prisma` |
| 5.1 | No cascade deletes | 🟡 Medium | `schema.prisma` |
| 5.2 | Migration drops all user data | 🔴 Critical | `migrations/` |
| 5.3 | No indexes on foreign keys | 🟡 Medium | `schema.prisma` |
| 6.1 | All tests are placeholder stubs | 🟠 High | `*.spec.ts` |
| 6.2 | Test modules missing dependency mocks | 🟠 High | `*.spec.ts` |
| 7.1 | DB password hard-coded in compose | 🔴 Critical | `docker-compose.yml` |
| 7.2 | No `.env.example` | 🟡 Medium | — |
| 7.3 | No Helmet security headers | 🟡 Medium | `main.ts` |
| 7.4 | Files on local disk, no cleanup | 🟡 Medium | `documents.controller.ts` |

**Legend:** 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low
