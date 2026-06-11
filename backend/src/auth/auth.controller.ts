import { Controller, Body, Post } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto/register.dto';

import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
    constructor(
        private authService: AuthService
      ) {}

    @Post('register')
        register(@Body() body: RegisterDto) {
        return this.authService.register(body.email, body.password, body.name);
    }

    @Post('login')
    login(@Body() body: any) {

    return this.authService.login(
        body.email,
        body.password
    );
    }

    @Post('refresh')
    refresh(@Body() body: any) {

    return this.authService.refresh(
        body.refreshToken
    );
    }
}
