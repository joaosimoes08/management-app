import { PartialType } from '@nestjs/swagger';
import { CreateApplicationLinkDto } from './create-application-link.dto';

export class UpdateApplicationLinkDto extends PartialType(CreateApplicationLinkDto) {}
