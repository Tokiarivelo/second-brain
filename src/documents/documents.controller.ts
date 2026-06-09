import { 
  Controller, 
  Post, 
  UploadedFile, 
  UseInterceptors, 
  ParseFilePipe, 
  FileTypeValidator, 
  MaxFileSizeValidator 
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('documents')
export class DocumentsController {

  @Post('upload')
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
    return {
      message: 'Fichier PDF uploadé avec succès !',
      filename: file.filename,
      path: file.path,
      size: file.size,
    };
  }
}
