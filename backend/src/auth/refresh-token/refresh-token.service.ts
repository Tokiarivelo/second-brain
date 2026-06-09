import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RefreshTokenService {

  constructor(
    private prisma: PrismaService
  ) {}

  async create(
    userId: number,
    token: string,
    expiresAt: Date,
  ) {

    return this.prisma.refreshToken.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    });
  }

  async find(token: string) {

    return this.prisma.refreshToken.findFirst({
      where: {
        token,
      },
    });
  }

  async delete(token: string) {

    return this.prisma.refreshToken.deleteMany({
      where: {
        token,
      },
    });
  }
}
