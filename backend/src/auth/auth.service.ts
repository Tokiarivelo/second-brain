import {
  Injectable,
  UnauthorizedException
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';

import { UsersService } from '../users/users.service';
import { RefreshTokenService } from './refresh-token/refresh-token.service';

import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {

    constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private refreshTokenService: RefreshTokenService,
    ) {}

    async register(email: string, password: string, name: string) {

        const hashedPassword =
            await bcrypt.hash(password, 12);

        return this.usersService.create(
            email,
            hashedPassword,
            name
        );
    }

    async login(email: string, passwordHash: string) {

        const user =
            await this.usersService.findByEmail(email);

        if (!user) {
            throw new UnauthorizedException();
        }

        const match =
            await bcrypt.compare(
            passwordHash,
            user.passwordHash
            
            );

        if (!match) {
            throw new UnauthorizedException();
        }

        const token = this.jwtService.sign({
            sub: user.id,
            email: user.email
        },
        {
            expiresIn: '15m',
        },
        );

        const refreshToken = this.jwtService.sign(
        {
            sub: user.id,
        },
        {
            expiresIn: '7d',
        },
        );

        await this.refreshTokenService.create(
            user.id,
            refreshToken,
            new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000
            ),
        );


        return {
            access_token: token,
            refresh_token : refreshToken
        };
        
    }

    // ✅ CORRECT — token rotation
    async refresh(refreshToken: string) {
    const storedToken = await this.refreshTokenService.find(refreshToken);

    if (!storedToken || storedToken.expiresAt < new Date()) {
        throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Invalidate the used token immediately
    await this.refreshTokenService.delete(refreshToken);

    // ✅ CORRECT
    let payload: { sub: number };
    try {
        payload = this.jwtService.verify(refreshToken);
    } catch {
        throw new UnauthorizedException('Invalid refresh token');
    }

    const newAccessToken = this.jwtService.sign(
        { sub: payload.sub },
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
}
