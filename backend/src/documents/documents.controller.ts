import { 
  Controller, 
  Post, 
  Get,
  Param,
  Delete,
  UploadedFile, 
  UseInterceptors, 
  ParseFilePipe, 
  FileTypeValidator, 
  MaxFileSizeValidator 
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {

  constructor(
    private readonly documentsService: DocumentsService
  ) {}

  // Chercher tout les document
  @Get()
  findAll() {
    return this.documentsService.findAll();
  }

  // Récupérer un document selon son ID
  @Get(':id')
  findOne(
    @Param('id') id: string
  ) {
    return this.documentsService.findOne(
      Number(id)
    );
  }

  // Supprimer un document
  @Delete(':id')
  remove(
    @Param('id') id: string
  ) {
    return this.documentsService.remove(
      Number(id)
    );
  }

  // Uploader le document
  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      // Configuration optionnelle pour sauvegarder directement sur le disque
      storage: diskStorage({
        destination: './uploads', // Dossier de destination
        filename: (req, file, callback) => {
          // Génère un nom unique pour éviter les écrasements
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          callback(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
    }),
  )
  uploadPdf(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // Limite la taille à 20 Mo
          new MaxFileSizeValidator({ maxSize: 1024 * 1024 * 20 }), 
          // Vérifie que le type MIME est obligatoirement un PDF
          new FileTypeValidator({ fileType: 'application/pdf' }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    // Si la validation réussit, le fichier est enregistré
    return this.documentsService.create(file);
    }
}
