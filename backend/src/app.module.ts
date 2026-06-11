import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { PrismaModule} from './prisma/prisma.module';
import { DocumentsModule } from './documents/documents.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [AuthModule, UsersModule, PrismaModule, DocumentsModule, 
  ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]), /* 10 requests / minute]*/],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
