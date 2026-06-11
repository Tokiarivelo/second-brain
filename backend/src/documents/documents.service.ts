import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DocumentsService {

    constructor(
        private prisma: PrismaService
    ) {}

    async create(file: Express.Multer.File) {

        return this.prisma.document.create({
        data: {
            userId: 1, // temporaire
            title: file.originalname,
            filePath: file.path,
            fileSize: file.size,
            status: 'UPLOADED'
        }
        });
    }

    async findAll() {

        return this.prisma.document.findMany({
            orderBy: {
            createdAt: 'desc'
            }
        });
    }

    async findOne(id: number) {

        return this.prisma.document.findUnique({
            where: {
            id
            }
        });
    }

    async remove(id: number) {

        const document =
            await this.prisma.document.findUnique({
            where: { id }
            });

        if (!document) {
            return null;
        }

        return this.prisma.document.delete({
            where: {
            id
            }
        });
    }
}
