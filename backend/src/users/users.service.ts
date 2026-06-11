import { Injectable } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class UsersService {

  constructor(
    private prisma: PrismaService
  ) {}

  async findByEmail(email: string) {

    return this.prisma.user.findUnique({
      where: { email }
    });
  }

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
}
