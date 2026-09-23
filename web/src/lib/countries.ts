/**
 * Lista completa de países com bandeira (emoji), código ISO-2, nome em PT-BR,
 * e código de discagem (DDI). Usada no seletor de telefone do cadastro de transação.
 *
 * - `flag` é gerado a partir do ISO-2 via Regional Indicator codepoints, então
 *   renderiza como bandeira em qualquer plataforma que suporte emoji.
 * - `name` em pt-BR para combinar com o resto da interface.
 * - Inclui `nameEn` e `nameNoAccent` para a busca casar com "Argentina", "argentina",
 *   "ARGENTINA", "arg", "argen" e também com nomes em inglês ("united states").
 * - `priority` marca países usuais dos clientes Demo Source (LatAm + alguns), esses
 *   aparecem no topo da lista quando não há busca.
 */

export interface Country {
  code: string // ISO 3166-1 alpha-2
  dial: string // dial code sem o "+"
  name: string
  nameEn: string
  flag: string
  priority?: number // menor = mais alto na lista. Sem prioridade = ordem alfabética.
}

/**
 * Converte "BR" → "🇧🇷" usando Regional Indicator codepoints.
 * Cada letra A-Z é mapeada para U+1F1E6..U+1F1FF.
 */
function flagOf(iso2: string): string {
  return iso2
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('')
}

// Países priorizados (clientes mais comuns da Demo Source).
const PRIORITY: Record<string, number> = {
  BR: 1,
  AR: 2,
  CL: 3,
  CO: 4,
  MX: 5,
  PE: 6,
  UY: 7,
  PY: 8,
  BO: 9,
  EC: 10,
  VE: 11,
  US: 12,
  PT: 13,
  ES: 14,
}

interface RawCountry {
  code: string
  dial: string
  name: string
  nameEn: string
}

const RAW: RawCountry[] = [
  { code: 'AF', dial: '93', name: 'Afeganistão', nameEn: 'Afghanistan' },
  { code: 'AL', dial: '355', name: 'Albânia', nameEn: 'Albania' },
  { code: 'DZ', dial: '213', name: 'Argélia', nameEn: 'Algeria' },
  { code: 'AS', dial: '1684', name: 'Samoa Americana', nameEn: 'American Samoa' },
  { code: 'AD', dial: '376', name: 'Andorra', nameEn: 'Andorra' },
  { code: 'AO', dial: '244', name: 'Angola', nameEn: 'Angola' },
  { code: 'AI', dial: '1264', name: 'Anguilla', nameEn: 'Anguilla' },
  { code: 'AG', dial: '1268', name: 'Antígua e Barbuda', nameEn: 'Antigua and Barbuda' },
  { code: 'AR', dial: '54', name: 'Argentina', nameEn: 'Argentina' },
  { code: 'AM', dial: '374', name: 'Armênia', nameEn: 'Armenia' },
  { code: 'AW', dial: '297', name: 'Aruba', nameEn: 'Aruba' },
  { code: 'AU', dial: '61', name: 'Austrália', nameEn: 'Australia' },
  { code: 'AT', dial: '43', name: 'Áustria', nameEn: 'Austria' },
  { code: 'AZ', dial: '994', name: 'Azerbaijão', nameEn: 'Azerbaijan' },
  { code: 'BS', dial: '1242', name: 'Bahamas', nameEn: 'Bahamas' },
  { code: 'BH', dial: '973', name: 'Bahrein', nameEn: 'Bahrain' },
  { code: 'BD', dial: '880', name: 'Bangladesh', nameEn: 'Bangladesh' },
  { code: 'BB', dial: '1246', name: 'Barbados', nameEn: 'Barbados' },
  { code: 'BY', dial: '375', name: 'Bielorrússia', nameEn: 'Belarus' },
  { code: 'BE', dial: '32', name: 'Bélgica', nameEn: 'Belgium' },
  { code: 'BZ', dial: '501', name: 'Belize', nameEn: 'Belize' },
  { code: 'BJ', dial: '229', name: 'Benin', nameEn: 'Benin' },
  { code: 'BM', dial: '1441', name: 'Bermudas', nameEn: 'Bermuda' },
  { code: 'BT', dial: '975', name: 'Butão', nameEn: 'Bhutan' },
  { code: 'BO', dial: '591', name: 'Bolívia', nameEn: 'Bolivia' },
  { code: 'BA', dial: '387', name: 'Bósnia e Herzegovina', nameEn: 'Bosnia and Herzegovina' },
  { code: 'BW', dial: '267', name: 'Botsuana', nameEn: 'Botswana' },
  { code: 'BR', dial: '55', name: 'Brasil', nameEn: 'Brazil' },
  { code: 'IO', dial: '246', name: 'Território Britânico do Oceano Índico', nameEn: 'British Indian Ocean Territory' },
  { code: 'VG', dial: '1284', name: 'Ilhas Virgens Britânicas', nameEn: 'British Virgin Islands' },
  { code: 'BN', dial: '673', name: 'Brunei', nameEn: 'Brunei' },
  { code: 'BG', dial: '359', name: 'Bulgária', nameEn: 'Bulgaria' },
  { code: 'BF', dial: '226', name: 'Burkina Faso', nameEn: 'Burkina Faso' },
  { code: 'BI', dial: '257', name: 'Burundi', nameEn: 'Burundi' },
  { code: 'KH', dial: '855', name: 'Camboja', nameEn: 'Cambodia' },
  { code: 'CM', dial: '237', name: 'Camarões', nameEn: 'Cameroon' },
  { code: 'CA', dial: '1', name: 'Canadá', nameEn: 'Canada' },
  { code: 'CV', dial: '238', name: 'Cabo Verde', nameEn: 'Cape Verde' },
  { code: 'KY', dial: '1345', name: 'Ilhas Cayman', nameEn: 'Cayman Islands' },
  { code: 'CF', dial: '236', name: 'República Centro-Africana', nameEn: 'Central African Republic' },
  { code: 'TD', dial: '235', name: 'Chade', nameEn: 'Chad' },
  { code: 'CL', dial: '56', name: 'Chile', nameEn: 'Chile' },
  { code: 'CN', dial: '86', name: 'China', nameEn: 'China' },
  { code: 'CX', dial: '61', name: 'Ilha Christmas', nameEn: 'Christmas Island' },
  { code: 'CC', dial: '61', name: 'Ilhas Cocos', nameEn: 'Cocos Islands' },
  { code: 'CO', dial: '57', name: 'Colômbia', nameEn: 'Colombia' },
  { code: 'KM', dial: '269', name: 'Comores', nameEn: 'Comoros' },
  { code: 'CK', dial: '682', name: 'Ilhas Cook', nameEn: 'Cook Islands' },
  { code: 'CR', dial: '506', name: 'Costa Rica', nameEn: 'Costa Rica' },
  { code: 'HR', dial: '385', name: 'Croácia', nameEn: 'Croatia' },
  { code: 'CU', dial: '53', name: 'Cuba', nameEn: 'Cuba' },
  { code: 'CW', dial: '599', name: 'Curaçao', nameEn: 'Curacao' },
  { code: 'CY', dial: '357', name: 'Chipre', nameEn: 'Cyprus' },
  { code: 'CZ', dial: '420', name: 'República Tcheca', nameEn: 'Czech Republic' },
  { code: 'CD', dial: '243', name: 'República Democrática do Congo', nameEn: 'Democratic Republic of the Congo' },
  { code: 'DK', dial: '45', name: 'Dinamarca', nameEn: 'Denmark' },
  { code: 'DJ', dial: '253', name: 'Djibouti', nameEn: 'Djibouti' },
  { code: 'DM', dial: '1767', name: 'Dominica', nameEn: 'Dominica' },
  { code: 'DO', dial: '1', name: 'República Dominicana', nameEn: 'Dominican Republic' },
  { code: 'TL', dial: '670', name: 'Timor-Leste', nameEn: 'East Timor' },
  { code: 'EC', dial: '593', name: 'Equador', nameEn: 'Ecuador' },
  { code: 'EG', dial: '20', name: 'Egito', nameEn: 'Egypt' },
  { code: 'SV', dial: '503', name: 'El Salvador', nameEn: 'El Salvador' },
  { code: 'GQ', dial: '240', name: 'Guiné Equatorial', nameEn: 'Equatorial Guinea' },
  { code: 'ER', dial: '291', name: 'Eritreia', nameEn: 'Eritrea' },
  { code: 'EE', dial: '372', name: 'Estônia', nameEn: 'Estonia' },
  { code: 'ET', dial: '251', name: 'Etiópia', nameEn: 'Ethiopia' },
  { code: 'FK', dial: '500', name: 'Ilhas Malvinas', nameEn: 'Falkland Islands' },
  { code: 'FO', dial: '298', name: 'Ilhas Faroé', nameEn: 'Faroe Islands' },
  { code: 'FJ', dial: '679', name: 'Fiji', nameEn: 'Fiji' },
  { code: 'FI', dial: '358', name: 'Finlândia', nameEn: 'Finland' },
  { code: 'FR', dial: '33', name: 'França', nameEn: 'France' },
  { code: 'PF', dial: '689', name: 'Polinésia Francesa', nameEn: 'French Polynesia' },
  { code: 'GA', dial: '241', name: 'Gabão', nameEn: 'Gabon' },
  { code: 'GM', dial: '220', name: 'Gâmbia', nameEn: 'Gambia' },
  { code: 'GE', dial: '995', name: 'Geórgia', nameEn: 'Georgia' },
  { code: 'DE', dial: '49', name: 'Alemanha', nameEn: 'Germany' },
  { code: 'GH', dial: '233', name: 'Gana', nameEn: 'Ghana' },
  { code: 'GI', dial: '350', name: 'Gibraltar', nameEn: 'Gibraltar' },
  { code: 'GR', dial: '30', name: 'Grécia', nameEn: 'Greece' },
  { code: 'GL', dial: '299', name: 'Groenlândia', nameEn: 'Greenland' },
  { code: 'GD', dial: '1473', name: 'Granada', nameEn: 'Grenada' },
  { code: 'GU', dial: '1671', name: 'Guam', nameEn: 'Guam' },
  { code: 'GT', dial: '502', name: 'Guatemala', nameEn: 'Guatemala' },
  { code: 'GG', dial: '441481', name: 'Guernsey', nameEn: 'Guernsey' },
  { code: 'GN', dial: '224', name: 'Guiné', nameEn: 'Guinea' },
  { code: 'GW', dial: '245', name: 'Guiné-Bissau', nameEn: 'Guinea-Bissau' },
  { code: 'GY', dial: '592', name: 'Guiana', nameEn: 'Guyana' },
  { code: 'HT', dial: '509', name: 'Haiti', nameEn: 'Haiti' },
  { code: 'HN', dial: '504', name: 'Honduras', nameEn: 'Honduras' },
  { code: 'HK', dial: '852', name: 'Hong Kong', nameEn: 'Hong Kong' },
  { code: 'HU', dial: '36', name: 'Hungria', nameEn: 'Hungary' },
  { code: 'IS', dial: '354', name: 'Islândia', nameEn: 'Iceland' },
  { code: 'IN', dial: '91', name: 'Índia', nameEn: 'India' },
  { code: 'ID', dial: '62', name: 'Indonésia', nameEn: 'Indonesia' },
  { code: 'IR', dial: '98', name: 'Irã', nameEn: 'Iran' },
  { code: 'IQ', dial: '964', name: 'Iraque', nameEn: 'Iraq' },
  { code: 'IE', dial: '353', name: 'Irlanda', nameEn: 'Ireland' },
  { code: 'IM', dial: '441624', name: 'Ilha de Man', nameEn: 'Isle of Man' },
  { code: 'IL', dial: '972', name: 'Israel', nameEn: 'Israel' },
  { code: 'IT', dial: '39', name: 'Itália', nameEn: 'Italy' },
  { code: 'CI', dial: '225', name: 'Costa do Marfim', nameEn: 'Ivory Coast' },
  { code: 'JM', dial: '1876', name: 'Jamaica', nameEn: 'Jamaica' },
  { code: 'JP', dial: '81', name: 'Japão', nameEn: 'Japan' },
  { code: 'JE', dial: '441534', name: 'Jersey', nameEn: 'Jersey' },
  { code: 'JO', dial: '962', name: 'Jordânia', nameEn: 'Jordan' },
  { code: 'KZ', dial: '7', name: 'Cazaquistão', nameEn: 'Kazakhstan' },
  { code: 'KE', dial: '254', name: 'Quênia', nameEn: 'Kenya' },
  { code: 'KI', dial: '686', name: 'Kiribati', nameEn: 'Kiribati' },
  { code: 'XK', dial: '383', name: 'Kosovo', nameEn: 'Kosovo' },
  { code: 'KW', dial: '965', name: 'Kuwait', nameEn: 'Kuwait' },
  { code: 'KG', dial: '996', name: 'Quirguistão', nameEn: 'Kyrgyzstan' },
  { code: 'LA', dial: '856', name: 'Laos', nameEn: 'Laos' },
  { code: 'LV', dial: '371', name: 'Letônia', nameEn: 'Latvia' },
  { code: 'LB', dial: '961', name: 'Líbano', nameEn: 'Lebanon' },
  { code: 'LS', dial: '266', name: 'Lesoto', nameEn: 'Lesotho' },
  { code: 'LR', dial: '231', name: 'Libéria', nameEn: 'Liberia' },
  { code: 'LY', dial: '218', name: 'Líbia', nameEn: 'Libya' },
  { code: 'LI', dial: '423', name: 'Liechtenstein', nameEn: 'Liechtenstein' },
  { code: 'LT', dial: '370', name: 'Lituânia', nameEn: 'Lithuania' },
  { code: 'LU', dial: '352', name: 'Luxemburgo', nameEn: 'Luxembourg' },
  { code: 'MO', dial: '853', name: 'Macau', nameEn: 'Macau' },
  { code: 'MK', dial: '389', name: 'Macedônia do Norte', nameEn: 'Macedonia' },
  { code: 'MG', dial: '261', name: 'Madagascar', nameEn: 'Madagascar' },
  { code: 'MW', dial: '265', name: 'Malawi', nameEn: 'Malawi' },
  { code: 'MY', dial: '60', name: 'Malásia', nameEn: 'Malaysia' },
  { code: 'MV', dial: '960', name: 'Maldivas', nameEn: 'Maldives' },
  { code: 'ML', dial: '223', name: 'Mali', nameEn: 'Mali' },
  { code: 'MT', dial: '356', name: 'Malta', nameEn: 'Malta' },
  { code: 'MH', dial: '692', name: 'Ilhas Marshall', nameEn: 'Marshall Islands' },
  { code: 'MR', dial: '222', name: 'Mauritânia', nameEn: 'Mauritania' },
  { code: 'MU', dial: '230', name: 'Maurício', nameEn: 'Mauritius' },
  { code: 'YT', dial: '262', name: 'Mayotte', nameEn: 'Mayotte' },
  { code: 'MX', dial: '52', name: 'México', nameEn: 'Mexico' },
  { code: 'FM', dial: '691', name: 'Micronésia', nameEn: 'Micronesia' },
  { code: 'MD', dial: '373', name: 'Moldávia', nameEn: 'Moldova' },
  { code: 'MC', dial: '377', name: 'Mônaco', nameEn: 'Monaco' },
  { code: 'MN', dial: '976', name: 'Mongólia', nameEn: 'Mongolia' },
  { code: 'ME', dial: '382', name: 'Montenegro', nameEn: 'Montenegro' },
  { code: 'MS', dial: '1664', name: 'Montserrat', nameEn: 'Montserrat' },
  { code: 'MA', dial: '212', name: 'Marrocos', nameEn: 'Morocco' },
  { code: 'MZ', dial: '258', name: 'Moçambique', nameEn: 'Mozambique' },
  { code: 'MM', dial: '95', name: 'Mianmar', nameEn: 'Myanmar' },
  { code: 'NA', dial: '264', name: 'Namíbia', nameEn: 'Namibia' },
  { code: 'NR', dial: '674', name: 'Nauru', nameEn: 'Nauru' },
  { code: 'NP', dial: '977', name: 'Nepal', nameEn: 'Nepal' },
  { code: 'NL', dial: '31', name: 'Países Baixos', nameEn: 'Netherlands' },
  { code: 'AN', dial: '599', name: 'Antilhas Holandesas', nameEn: 'Netherlands Antilles' },
  { code: 'NC', dial: '687', name: 'Nova Caledônia', nameEn: 'New Caledonia' },
  { code: 'NZ', dial: '64', name: 'Nova Zelândia', nameEn: 'New Zealand' },
  { code: 'NI', dial: '505', name: 'Nicarágua', nameEn: 'Nicaragua' },
  { code: 'NE', dial: '227', name: 'Níger', nameEn: 'Niger' },
  { code: 'NG', dial: '234', name: 'Nigéria', nameEn: 'Nigeria' },
  { code: 'NU', dial: '683', name: 'Niue', nameEn: 'Niue' },
  { code: 'KP', dial: '850', name: 'Coreia do Norte', nameEn: 'North Korea' },
  { code: 'MP', dial: '1670', name: 'Ilhas Marianas do Norte', nameEn: 'Northern Mariana Islands' },
  { code: 'NO', dial: '47', name: 'Noruega', nameEn: 'Norway' },
  { code: 'OM', dial: '968', name: 'Omã', nameEn: 'Oman' },
  { code: 'PK', dial: '92', name: 'Paquistão', nameEn: 'Pakistan' },
  { code: 'PW', dial: '680', name: 'Palau', nameEn: 'Palau' },
  { code: 'PS', dial: '970', name: 'Palestina', nameEn: 'Palestine' },
  { code: 'PA', dial: '507', name: 'Panamá', nameEn: 'Panama' },
  { code: 'PG', dial: '675', name: 'Papua-Nova Guiné', nameEn: 'Papua New Guinea' },
  { code: 'PY', dial: '595', name: 'Paraguai', nameEn: 'Paraguay' },
  { code: 'PE', dial: '51', name: 'Peru', nameEn: 'Peru' },
  { code: 'PH', dial: '63', name: 'Filipinas', nameEn: 'Philippines' },
  { code: 'PN', dial: '64', name: 'Ilhas Pitcairn', nameEn: 'Pitcairn' },
  { code: 'PL', dial: '48', name: 'Polônia', nameEn: 'Poland' },
  { code: 'PT', dial: '351', name: 'Portugal', nameEn: 'Portugal' },
  { code: 'PR', dial: '1', name: 'Porto Rico', nameEn: 'Puerto Rico' },
  { code: 'QA', dial: '974', name: 'Catar', nameEn: 'Qatar' },
  { code: 'CG', dial: '242', name: 'República do Congo', nameEn: 'Republic of the Congo' },
  { code: 'RE', dial: '262', name: 'Reunião', nameEn: 'Reunion' },
  { code: 'RO', dial: '40', name: 'Romênia', nameEn: 'Romania' },
  { code: 'RU', dial: '7', name: 'Rússia', nameEn: 'Russia' },
  { code: 'RW', dial: '250', name: 'Ruanda', nameEn: 'Rwanda' },
  { code: 'BL', dial: '590', name: 'São Bartolomeu', nameEn: 'Saint Barthelemy' },
  { code: 'SH', dial: '290', name: 'Santa Helena', nameEn: 'Saint Helena' },
  { code: 'KN', dial: '1869', name: 'São Cristóvão e Névis', nameEn: 'Saint Kitts and Nevis' },
  { code: 'LC', dial: '1758', name: 'Santa Lúcia', nameEn: 'Saint Lucia' },
  { code: 'MF', dial: '590', name: 'São Martinho', nameEn: 'Saint Martin' },
  { code: 'PM', dial: '508', name: 'São Pedro e Miquelão', nameEn: 'Saint Pierre and Miquelon' },
  { code: 'VC', dial: '1784', name: 'São Vicente e Granadinas', nameEn: 'Saint Vincent and the Grenadines' },
  { code: 'WS', dial: '685', name: 'Samoa', nameEn: 'Samoa' },
  { code: 'SM', dial: '378', name: 'San Marino', nameEn: 'San Marino' },
  { code: 'ST', dial: '239', name: 'São Tomé e Príncipe', nameEn: 'Sao Tome and Principe' },
  { code: 'SA', dial: '966', name: 'Arábia Saudita', nameEn: 'Saudi Arabia' },
  { code: 'SN', dial: '221', name: 'Senegal', nameEn: 'Senegal' },
  { code: 'RS', dial: '381', name: 'Sérvia', nameEn: 'Serbia' },
  { code: 'SC', dial: '248', name: 'Seicheles', nameEn: 'Seychelles' },
  { code: 'SL', dial: '232', name: 'Serra Leoa', nameEn: 'Sierra Leone' },
  { code: 'SG', dial: '65', name: 'Singapura', nameEn: 'Singapore' },
  { code: 'SX', dial: '1721', name: 'Sint Maarten', nameEn: 'Sint Maarten' },
  { code: 'SK', dial: '421', name: 'Eslováquia', nameEn: 'Slovakia' },
  { code: 'SI', dial: '386', name: 'Eslovênia', nameEn: 'Slovenia' },
  { code: 'SB', dial: '677', name: 'Ilhas Salomão', nameEn: 'Solomon Islands' },
  { code: 'SO', dial: '252', name: 'Somália', nameEn: 'Somalia' },
  { code: 'ZA', dial: '27', name: 'África do Sul', nameEn: 'South Africa' },
  { code: 'KR', dial: '82', name: 'Coreia do Sul', nameEn: 'South Korea' },
  { code: 'SS', dial: '211', name: 'Sudão do Sul', nameEn: 'South Sudan' },
  { code: 'ES', dial: '34', name: 'Espanha', nameEn: 'Spain' },
  { code: 'LK', dial: '94', name: 'Sri Lanka', nameEn: 'Sri Lanka' },
  { code: 'SD', dial: '249', name: 'Sudão', nameEn: 'Sudan' },
  { code: 'SR', dial: '597', name: 'Suriname', nameEn: 'Suriname' },
  { code: 'SJ', dial: '47', name: 'Svalbard e Jan Mayen', nameEn: 'Svalbard and Jan Mayen' },
  { code: 'SZ', dial: '268', name: 'Essuatíni', nameEn: 'Swaziland' },
  { code: 'SE', dial: '46', name: 'Suécia', nameEn: 'Sweden' },
  { code: 'CH', dial: '41', name: 'Suíça', nameEn: 'Switzerland' },
  { code: 'SY', dial: '963', name: 'Síria', nameEn: 'Syria' },
  { code: 'TW', dial: '886', name: 'Taiwan', nameEn: 'Taiwan' },
  { code: 'TJ', dial: '992', name: 'Tajiquistão', nameEn: 'Tajikistan' },
  { code: 'TZ', dial: '255', name: 'Tanzânia', nameEn: 'Tanzania' },
  { code: 'TH', dial: '66', name: 'Tailândia', nameEn: 'Thailand' },
  { code: 'TG', dial: '228', name: 'Togo', nameEn: 'Togo' },
  { code: 'TK', dial: '690', name: 'Tokelau', nameEn: 'Tokelau' },
  { code: 'TO', dial: '676', name: 'Tonga', nameEn: 'Tonga' },
  { code: 'TT', dial: '1868', name: 'Trinidad e Tobago', nameEn: 'Trinidad and Tobago' },
  { code: 'TN', dial: '216', name: 'Tunísia', nameEn: 'Tunisia' },
  { code: 'TR', dial: '90', name: 'Turquia', nameEn: 'Turkey' },
  { code: 'TM', dial: '993', name: 'Turcomenistão', nameEn: 'Turkmenistan' },
  { code: 'TC', dial: '1649', name: 'Ilhas Turcas e Caicos', nameEn: 'Turks and Caicos Islands' },
  { code: 'TV', dial: '688', name: 'Tuvalu', nameEn: 'Tuvalu' },
  { code: 'VI', dial: '1340', name: 'Ilhas Virgens Americanas', nameEn: 'U.S. Virgin Islands' },
  { code: 'UG', dial: '256', name: 'Uganda', nameEn: 'Uganda' },
  { code: 'UA', dial: '380', name: 'Ucrânia', nameEn: 'Ukraine' },
  { code: 'AE', dial: '971', name: 'Emirados Árabes Unidos', nameEn: 'United Arab Emirates' },
  { code: 'GB', dial: '44', name: 'Reino Unido', nameEn: 'United Kingdom' },
  { code: 'US', dial: '1', name: 'Estados Unidos', nameEn: 'United States' },
  { code: 'UY', dial: '598', name: 'Uruguai', nameEn: 'Uruguay' },
  { code: 'UZ', dial: '998', name: 'Uzbequistão', nameEn: 'Uzbekistan' },
  { code: 'VU', dial: '678', name: 'Vanuatu', nameEn: 'Vanuatu' },
  { code: 'VA', dial: '379', name: 'Vaticano', nameEn: 'Vatican' },
  { code: 'VE', dial: '58', name: 'Venezuela', nameEn: 'Venezuela' },
  { code: 'VN', dial: '84', name: 'Vietnã', nameEn: 'Vietnam' },
  { code: 'WF', dial: '681', name: 'Wallis e Futuna', nameEn: 'Wallis and Futuna' },
  { code: 'EH', dial: '212', name: 'Saara Ocidental', nameEn: 'Western Sahara' },
  { code: 'YE', dial: '967', name: 'Iêmen', nameEn: 'Yemen' },
  { code: 'ZM', dial: '260', name: 'Zâmbia', nameEn: 'Zambia' },
  { code: 'ZW', dial: '263', name: 'Zimbábue', nameEn: 'Zimbabwe' },
]

/**
 * Remove acentos para facilitar match no search ("equador" casa com "Equador").
 */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export const COUNTRIES: Country[] = RAW.map((c) => ({
  ...c,
  flag: flagOf(c.code),
  priority: PRIORITY[c.code],
})).sort((a, b) => {
  // Priorizados primeiro (na ordem definida em PRIORITY), depois alfabético em pt-BR.
  if (a.priority && b.priority) return a.priority - b.priority
  if (a.priority) return -1
  if (b.priority) return 1
  return a.name.localeCompare(b.name, 'pt-BR')
})

const SEARCH_INDEX = COUNTRIES.map((c) => ({
  country: c,
  haystack: stripAccents(
    `${c.name} ${c.nameEn} ${c.code} +${c.dial} ${c.dial}`,
  ).toLowerCase(),
}))

/**
 * Busca países por nome (pt-BR ou inglês, com/sem acento), ISO ou dial code.
 * Retorna na ordem original (prioridade + alfabético).
 */
export function searchCountries(query: string): Country[] {
  const q = stripAccents(query.trim()).toLowerCase()
  if (!q) return COUNTRIES
  return SEARCH_INDEX.filter((s) => s.haystack.includes(q)).map((s) => s.country)
}

/**
 * Busca a entrada Country pelo seu dial code. Como alguns países compartilham
 * o mesmo dial (ex.: US/CA/PR usam "1"), retorna o de maior prioridade.
 */
export function countryByDial(dial: string): Country | undefined {
  return COUNTRIES.find((c) => c.dial === dial)
}

// Index ISO-2 → Country pra lookup O(1) do país que vem da origem.
const BY_ISO: Map<string, Country> = new Map(
  COUNTRIES.map((c) => [c.code, c]),
)

/**
 * Busca a entrada Country pelo código ISO-2 (ex.: "BR" → Brasil 🇧🇷).
 * Usada pela distribuição geográfica pra expandir o `country` abreviado que
 * vem do sistema de origem no nome completo + bandeira. Case-insensitive; retorna
 * `undefined` para códigos desconhecidos (o chamador cai no fallback DDI).
 */
export function countryByIso(iso2: string | undefined | null): Country | undefined {
  if (!iso2) return undefined
  return BY_ISO.get(iso2.trim().toUpperCase())
}

/**
 * Faz o "parse" de uma string de telefone salva no Firestore para `{ dial, phone }`.
 * Cobre os formatos comuns:
 *  - "+55 11999999999"   → { dial: '55', phone: '11999999999' }
 *  - "+5511999999999"    → { dial: '55', phone: '11999999999' }
 *  - "11 99999-9999"     → { dial: '55', phone: '11 99999-9999' } (default BR)
 *  - ""                  → { dial: '55', phone: '' }
 *
 * O "best dial" é o dial code conhecido (1-4 dígitos) com maior prefix match na
 * string. Se a string não começa com "+", assume BR (55).
 */
export function parsePhone(raw: string | undefined | null): {
  dial: string
  phone: string
} {
  const fallback = { dial: '55', phone: '' }
  if (!raw) return fallback

  const trimmed = raw.trim()
  if (!trimmed) return fallback

  if (!trimmed.startsWith('+')) {
    return { dial: '55', phone: trimmed }
  }

  // Remove "+" e captura sequência de dígitos iniciais.
  const rest = trimmed.slice(1)
  const m = rest.match(/^(\d+)(.*)$/)
  if (!m) return fallback
  const digits = m[1]
  const tail = m[2]

  // Tenta encaixar o dial code de 1 a 4 dígitos (do mais longo pro mais curto).
  for (let len = Math.min(4, digits.length); len >= 1; len--) {
    const candidate = digits.slice(0, len)
    if (COUNTRIES.some((c) => c.dial === candidate)) {
      const phone = (digits.slice(len) + tail).trimStart()
      return { dial: candidate, phone }
    }
  }
  return { dial: digits.slice(0, 2) || '55', phone: tail.trim() }
}
