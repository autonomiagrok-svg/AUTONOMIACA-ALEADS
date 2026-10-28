/**
 * Mapeamento público de estabelecimentos B2B em Governador Valadares/MG
 * Fontes: guias comerciais, listagens de restaurantes/bares/padarias (dados públicos).
 * Não é censo 100% da cidade — é base operacional para prospecção Xiquim Vargas.
 */
import { importRows, listLeads } from './store.js';

const L = (row) => ({
  cidade: 'Governador Valadares',
  uf: 'MG',
  status: 'NOVO',
  potencial: row.potencial || 'MEDIO',
  fonte: row.fonte || 'Guia público / listagem comercial',
  fonte_url: row.fonte_url || null,
  ...row,
});

const LEADS = [
  // ——— BARES ———
  L({ nome_fantasia: 'Bar do Cezinha', segmento: 'BAR', bairro: 'Centro', endereco: 'Centro', potencial: 'ALTO', fonte: 'Restaurant Guru / listagens públicas' }),
  L({ nome_fantasia: "Pinô Wine Bar", segmento: 'BAR', subsegmento: 'Wine bar', bairro: 'Centro', potencial: 'ALTO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'DOZE com 38 Sport Bar', segmento: 'BAR', subsegmento: 'Sport bar', bairro: 'Centro', potencial: 'ALTO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'NaOrla Restô Bar', segmento: 'BAR', bairro: 'Centro', potencial: 'ALTO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'Moa Bar', segmento: 'BAR', potencial: 'MEDIO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'Sinucas Bar', segmento: 'BAR', potencial: 'MEDIO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'Laut Beer Express', segmento: 'BAR', potencial: 'ALTO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'Bar do Magá', segmento: 'BAR', potencial: 'MEDIO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'Trilhas Bar / Bar do Jefinho', segmento: 'BAR', potencial: 'MEDIO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: "Otyle's Bar", segmento: 'BAR', potencial: 'MEDIO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'Bar do Luiz Maclawdy', segmento: 'BAR', potencial: 'MEDIO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: "Marcu's Bar", segmento: 'BAR', potencial: 'MEDIO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'Bar Bom Ti Vê', segmento: 'BAR', potencial: 'MEDIO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'Casarão Premium Bar', segmento: 'BAR', potencial: 'ALTO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: "Du'Cantu's Bar", segmento: 'BAR', endereco: 'Rua Coronel Roberto Soares Ferreira, 453', bairro: 'Lourdes', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: "Bruno's Bar", segmento: 'BAR', endereco: 'Rua Principal, 122', bairro: 'Jardim Atalaia', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Indios Bar', segmento: 'BAR', endereco: 'Av. Minas Gerais, 1130', bairro: 'Nossa Senhora das Graças', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Savannah Bar', segmento: 'BAR', endereco: 'Rua Marechal Deodoro, 901', bairro: 'Centro', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Scala Bar', segmento: 'BAR', endereco: 'Rua Santos Dumont, 795', bairro: 'Lourdes', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar Acari', segmento: 'BAR', endereco: 'Rua Santa Catarina, 111', bairro: 'Lourdes', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar Altinópolis', segmento: 'BAR', endereco: 'Av. Beira Lago, 242', bairro: 'Altinópolis', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar Bom Jesus', segmento: 'BAR', endereco: 'Rua Rodrigues Alves, 1248', bairro: 'Santa Rita', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar Brasília', segmento: 'BAR', endereco: 'Rua Marechal Floriano, s/n', bairro: 'Centro', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar Céu Azul', segmento: 'BAR', endereco: 'Av. Minas Gerais, 1123', bairro: 'Nossa Senhora das Graças', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar do Bigode', segmento: 'BAR', endereco: 'Rua Israel Pinheiro, 3810', bairro: 'Lourdes', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar Vila Bretas', segmento: 'BAR', endereco: 'Rua Oto Nunes Coelho, 125', bairro: 'Vila Bretas', telefone: '(33) 3508-1300', potencial: 'ALTO', fonte: 'menuweb / guias' }),
  L({ nome_fantasia: 'Bar do Fred', segmento: 'BAR', endereco: 'Rua Bárbara Heliodora', bairro: 'Centro', telefone: '(33) 3272-5384', potencial: 'ALTO', fonte: 'cardapio.menu' }),
  L({ nome_fantasia: 'Bar do Rodolfo', segmento: 'BAR', endereco: 'Rua Pedro Lessa, 1737', bairro: 'Lourdes', telefone: '(33) 98815-6634', potencial: 'ALTO', fonte: 'todosnegocios' }),
  L({ nome_fantasia: 'Bar Genaina', segmento: 'BAR', endereco: 'Av. Minas Gerais, 1670', bairro: 'Nossa Senhora das Graças', potencial: 'MEDIO', fonte: 'Solutudo / empresasembrasil' }),
  L({ nome_fantasia: 'Bar Maranhão', segmento: 'BAR', endereco: 'Rua Afonso Pena, 3430', bairro: 'Centro', potencial: 'ALTO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar Martins', segmento: 'BAR', endereco: 'Rua Peçanha, 1317', bairro: 'Nossa Senhora das Graças', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar do Peça', segmento: 'BAR', endereco: 'Rua Luxemburgo, 451', potencial: 'MEDIO', fonte: 'planetabrasileiro' }),
  L({ nome_fantasia: 'Top Strike Bar', segmento: 'BAR', endereco: 'Rua Dom Pedro II, 270', telefone: '(33) 3084-0190', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'Boteco do GL', segmento: 'BAR', endereco: 'Av. Jorge Campos Coelho, 350', telefone: '(33) 99819-3958', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: "Pub 2'MS Bar & Chooperia", segmento: 'BAR', endereco: 'Rua Marechal Floriano, 2251', bairro: 'Lourdes', potencial: 'ALTO', fonte: 'Acharei' }),
  L({ nome_fantasia: 'Bar do Litrao', segmento: 'BAR', endereco: 'Rua Dona Zulmira Pereira da Silva, 1013', bairro: 'São Paulo', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Bar do Doguinha', segmento: 'BAR', endereco: 'Rua Francisco de Paula Freitas, 296', bairro: 'Jardim Pérola', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Bar e Churrasquinho do Nego Bi', segmento: 'BAR', endereco: 'Rua Buenos Aires, 303', bairro: 'Jardim Pérola', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Tavares Bar', segmento: 'BAR', endereco: 'Av. Sete de Setembro, 2271', bairro: 'Esplanada', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Bar Beto', segmento: 'BAR', endereco: 'Rua Pedro Lessa, 431', bairro: 'Lourdes', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Veludo Bar & Lounge', segmento: 'BAR', endereco: 'Praça Julio Soares, 38', bairro: 'Ilha dos Araújos', potencial: 'ALTO', fonte: 'empresasembrasil' }),

  // ——— RESTAURANTES ———
  L({ nome_fantasia: 'JB Bar e Restaurante', segmento: 'RESTAURANTE', endereco: 'Rua Israel Pinheiro, 1970 / 970', bairro: 'São Pedro', telefone: '(33) 3271-3070', potencial: 'ALTO', fonte: 'Encontra Brasil / cardapio.menu' }),
  L({ nome_fantasia: 'Bar & Restaurante do Nenem', segmento: 'RESTAURANTE', endereco: 'Rua Israel Pinheiro, 83', bairro: 'São Pedro', telefone: '(33) 98884-2762', potencial: 'ALTO', fonte: 'Bendito Guia' }),
  L({ nome_fantasia: 'Bar e Restaurante do Juvenal', segmento: 'RESTAURANTE', endereco: 'Rua Israel Pinheiro, 1466', bairro: 'São Pedro', telefone: '(33) 3277-8744', potencial: 'ALTO', fonte: 'cardapio.menu' }),
  L({ nome_fantasia: 'Bar e Restaurante Minas Chef', segmento: 'RESTAURANTE', endereco: 'Rua Israel Pinheiro, 154', bairro: 'Universitário', potencial: 'MEDIO', fonte: 'planetabrasileiro' }),
  L({ nome_fantasia: 'Bar e Restaurante da Estação', segmento: 'RESTAURANTE', endereco: 'Praça João Paulo Pinheiro', bairro: 'Centro', telefone: '(33) 3271-7xxx', potencial: 'MEDIO', fonte: 'planetabrasileiro' }),
  L({ nome_fantasia: 'Bar e Restaurante Itanhomi', segmento: 'RESTAURANTE', endereco: 'Rua Marechal Floriano, 1086', bairro: 'Centro', potencial: 'MEDIO', fonte: 'planetabrasileiro' }),
  L({ nome_fantasia: 'Bar e Restaurante Sabor Mineiro', segmento: 'RESTAURANTE', endereco: 'Av. Minas Gerais, 1823', potencial: 'MEDIO', fonte: 'planetabrasileiro' }),
  L({ nome_fantasia: 'Bar e Restaurante Frigideira Mineira', segmento: 'RESTAURANTE', endereco: 'Av. Minas Gerais, 2953', bairro: 'Nossa Senhora das Graças', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Bar e Restaurante Carne de Panela', segmento: 'RESTAURANTE', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Antonelli\'s Comida por Quilo', segmento: 'RESTAURANTE', endereco: 'Av. Minas Gerais, 1660', bairro: 'Nossa Senhora das Graças', telefone: '(33) 3271-3447', potencial: 'ALTO', fonte: 'Encontra Brasil' }),
  L({ nome_fantasia: 'Bar China', segmento: 'RESTAURANTE', subsegmento: 'Oriental', endereco: 'Av. Rio Doce, 54', bairro: 'Ilha dos Araújos', telefone: '(33) 3275-1878', potencial: 'MEDIO', fonte: 'Encontra Brasil' }),
  L({ nome_fantasia: 'Bar e Restaurante Carijó', segmento: 'RESTAURANTE', endereco: 'Mercado Municipal, loja 29', bairro: 'Centro', potencial: 'MEDIO', fonte: 'Encontra Brasil' }),
  L({ nome_fantasia: 'Pampas Churrascaria e Restaurante', segmento: 'RESTAURANTE', endereco: 'Rua Leonardo Cristino, 3323', bairro: 'Centro', potencial: 'ALTO', fonte: 'cardapio.menu' }),
  L({ nome_fantasia: 'Garlic Restaurante Self Service', segmento: 'RESTAURANTE', endereco: 'Rua Marechal Floriano, 654', telefone: '(33) 3271-3141', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'Buteco Lagoa Grill', segmento: 'RESTAURANTE', endereco: 'Av. José Ivair F. Mattos, 999', bairro: 'Lagoa Santa', telefone: '(33) 99955-2784', potencial: 'ALTO', fonte: 'Portal Minas Gerais / kupi' }),
  L({ nome_fantasia: 'Restaurante Bom Tempero', segmento: 'RESTAURANTE', endereco: 'Rua Belo Horizonte, 604', bairro: 'Centro', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Restaurante Sabor da Praça', segmento: 'RESTAURANTE', endereco: 'Av. Brasil, 3161', bairro: 'Centro', potencial: 'MEDIO', fonte: 'PARAFÁ' }),
  L({ nome_fantasia: 'Restaurante Joa', segmento: 'RESTAURANTE', endereco: 'Av. Brasil, 3175', bairro: 'Centro', potencial: 'MEDIO', fonte: 'PARAFÁ' }),
  L({ nome_fantasia: 'Assim Assado GV', segmento: 'RESTAURANTE', endereco: 'Rua Prudente de Morais, 1097', bairro: 'Centro', potencial: 'MEDIO', fonte: 'Acharei' }),
  L({ nome_fantasia: 'Bar Restaurante Loilton', segmento: 'RESTAURANTE', endereco: 'Rua Ipanema, 296', bairro: 'Vila do Sol', telefone: '(33) 3272-1675', potencial: 'MEDIO', fonte: 'menuweb' }),
  L({ nome_fantasia: 'Villa Bar e Lanchonete', segmento: 'RESTAURANTE', endereco: 'Raimundo Silveira, 957', bairro: 'Vila Isa', potencial: 'MEDIO', fonte: 'planetabrasileiro' }),
  L({ nome_fantasia: 'Bel Oliveira', segmento: 'RESTAURANTE', subsegmento: 'Grego', endereco: 'Rua Dom Pedro II, 400', bairro: 'Centro', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Restaurante & Lanchonete Primor', segmento: 'RESTAURANTE', endereco: 'Rua Eder da Silveira, 440', bairro: 'Vila Isa', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Spettus', segmento: 'RESTAURANTE', endereco: 'Rua José de Tassis, 171', telefone: '(33) 3225-2308', potencial: 'ALTO', fonte: 'Portal Minas Gerais' }),

  // ——— LANCHONETES ———
  L({ nome_fantasia: 'Bob Lanches', segmento: 'LANCHONETE', endereco: 'Rua Francisco Sales, 18', bairro: 'Esplanada', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Boni Lanches Luci Bar', segmento: 'LANCHONETE', endereco: 'Rua Bárbara Heliodora, 258', bairro: 'Centro', telefone: '(33) 3271-8367', potencial: 'MEDIO', fonte: 'Acharei' }),
  L({ nome_fantasia: 'Champs Burguer', segmento: 'LANCHONETE', endereco: 'Rua José Ivair Ferreira Mattos, 765', telefone: '(33) 99884-2881', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'Elias Lanchonete e Sorveteria', segmento: 'LANCHONETE', endereco: 'Av. Eng. Humberto Tavares das Chagas, 471', telefone: '(33) 3083-5465', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'Bar e Lanchonete Sal da Terra', segmento: 'LANCHONETE', bairro: 'Centro', telefone: '(33) 3221-2536', potencial: 'MEDIO', fonte: 'maisdireto' }),
  L({ nome_fantasia: 'Come Burguer', segmento: 'LANCHONETE', endereco: 'Av. Venceslau Braz, 326', telefone: '(33) 3022-2020', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'Clube do Hambúrguer', segmento: 'LANCHONETE', endereco: 'Praça Ari Ferreira Mattos, 142', telefone: '(33) 99948-5808', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'Classe Vip Açaí e Hamburgueria', segmento: 'LANCHONETE', endereco: 'Av. Jorge Campos Coelho, 210', telefone: '(33) 99962-3852', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'Alô Pizzaria', segmento: 'LANCHONETE', subsegmento: 'Pizzaria', endereco: 'Av. JK, 2636', bairro: 'São Cristóvão', telefone: '(33) 3277-9770', potencial: 'MEDIO', fonte: 'Encontra Brasil' }),
  L({ nome_fantasia: 'Bar e Pizzaria Guedes', segmento: 'LANCHONETE', subsegmento: 'Pizzaria', endereco: 'Rua Miguel Fernandes Santos, 350', bairro: 'Santa Helena', telefone: '(33) 3272-3531', potencial: 'MEDIO', fonte: 'Encontra Brasil' }),
  L({ nome_fantasia: 'Waldinelly Pizza', segmento: 'LANCHONETE', subsegmento: 'Pizzaria', endereco: 'Av. Minas Gerais, 1824', bairro: 'Nossa Senhora das Graças', potencial: 'MEDIO', fonte: 'cardapio.menu' }),
  L({ nome_fantasia: 'Ponto de Encontro Pizzaria', segmento: 'LANCHONETE', subsegmento: 'Pizzaria', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'Batata Fly', segmento: 'LANCHONETE', endereco: 'Rua Sá Carvalho, 397', bairro: 'Centro', potencial: 'MEDIO', fonte: 'empresasembrasil' }),
  L({ nome_fantasia: 'Ki Balas', segmento: 'LANCHONETE', endereco: 'Av. Washington Luis, 766', bairro: 'Santa Rita', potencial: 'BAIXO', fonte: 'empresasembrasil' }),

  // ——— PADARIAS ———
  L({ nome_fantasia: 'Padaria Lopes', segmento: 'PADARIA', endereco: 'Rua Israel Pinheiro, 2965', bairro: 'São Pedro', telefone: '(33) 3221-8230', potencial: 'ALTO', fonte: 'Apontador / guiatelefone' }),
  L({ nome_fantasia: 'Padaria Paris', segmento: 'PADARIA', endereco: 'Av. Paris, 378', bairro: 'Grã-Duquesa', telefone: '(33) 3273-8501', potencial: 'MEDIO', fonte: 'Apontador' }),
  L({ nome_fantasia: 'Padaria Shekinah', segmento: 'PADARIA', endereco: 'Rua Israel Pinheiro, 4337', bairro: 'São Pedro', telefone: '(33) 3275-6703', potencial: 'MEDIO', fonte: 'Apontador' }),
  L({ nome_fantasia: 'Padaria da Ilha', segmento: 'PADARIA', endereco: 'Av. Piracicaba, 905', bairro: 'Ilha dos Araújos', telefone: '(33) 3275-3266', potencial: 'MEDIO', fonte: 'Apontador' }),
  L({ nome_fantasia: 'Padaria e Confeitaria Vitória', segmento: 'PADARIA', endereco: 'Av. Minas Gerais, 1850', bairro: 'Grã-Duquesa', telefone: '(33) 3276-2855', potencial: 'MEDIO', fonte: 'Apontador' }),
  L({ nome_fantasia: 'Padaria Natal', segmento: 'PADARIA', endereco: 'Rua Peçanha, 177', bairro: 'Centro', telefone: '(33) 3271-6426', potencial: 'MEDIO', fonte: 'Apontador' }),
  L({ nome_fantasia: 'Padaria Guanabara', segmento: 'PADARIA', endereco: 'Rua Afonso Pena, 1981 / Rua Francisco Sales, 205', bairro: 'Centro', telefone: '(33) 3271-4141', potencial: 'ALTO', fonte: 'Econodata / guiatelefone' }),
  L({ nome_fantasia: 'Padaria Guerra', segmento: 'PADARIA', endereco: 'Rua Marechal Floriano, 2190', bairro: 'Lourdes', potencial: 'ALTO', fonte: 'Restaurant Guru' }),
  L({ nome_fantasia: 'Pão Nobre Confeitaria', segmento: 'PADARIA', endereco: 'Rua Marechal Floriano, 1357', bairro: 'Centro', potencial: 'ALTO', fonte: 'Econodata' }),
  L({ nome_fantasia: 'Padaria Bom Pão', segmento: 'PADARIA', endereco: 'Av. Presidente Tancredo Neves, 730', bairro: 'Nossa Senhora das Graças', potencial: 'MEDIO', fonte: 'qualotelefone' }),
  L({ nome_fantasia: 'Panificadora Alvorada', segmento: 'PADARIA', endereco: 'Av. Rio Bahia, 548', bairro: 'Vila Isa', telefone: '(33) 3278-2300', potencial: 'MEDIO', fonte: 'guiatelefone' }),
  L({ nome_fantasia: 'Pão e Pizza', segmento: 'PADARIA', endereco: 'Rua Santos Dumont, 750', bairro: 'Lourdes', potencial: 'MEDIO', fonte: 'empresasembrasil / qualotelefone' }),
  L({ nome_fantasia: 'Panificadora Bom Jesus', segmento: 'PADARIA', endereco: 'Rua Virgolândia, 219', bairro: 'Santa Rita', telefone: '(33) 3273-4660', potencial: 'MEDIO', fonte: 'guiatelefone' }),
  L({ nome_fantasia: 'Panificadora Bom Gosto', segmento: 'PADARIA', endereco: 'Rua 2, 72', bairro: 'Sir', telefone: '(33) 3225-1820', potencial: 'MEDIO', fonte: 'guiatelefone' }),
  L({ nome_fantasia: 'Confeitaria Prado', segmento: 'PADARIA', endereco: 'Rua São Paulo, 718', bairro: 'Centro', potencial: 'MEDIO', fonte: 'guiatelefone' }),
  L({ nome_fantasia: 'Ki-Sabor Padaria e Cafeteria', segmento: 'PADARIA', endereco: 'Av. Pecuarista Carlos Machado Rangel, 236', bairro: 'Castanheiras', telefone: '(33) 3271-0688', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Padaria Gama', segmento: 'PADARIA', endereco: 'Av. Jorge Campos Coelho, 210', bairro: 'Jardim Alvorada', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Padaria e Confeitaria Tiradentes', segmento: 'PADARIA', endereco: 'Av. Décio Nunes Coelho, 513', bairro: 'Tiradentes', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Panificadora Ametista', segmento: 'PADARIA', endereco: 'Rua Ametista, 270', bairro: 'São Raimundo', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Panificadora Cambuy', segmento: 'PADARIA', endereco: 'Av. Coqueiral, 642', bairro: 'Turmalina', potencial: 'MEDIO', fonte: 'Solutudo' }),
  L({ nome_fantasia: 'Panificadora São Sebastião', segmento: 'PADARIA', endereco: 'Av. JK, 1342', bairro: 'São Paulo', potencial: 'MEDIO', fonte: 'qualotelefone' }),
  L({ nome_fantasia: 'Panificadora Pérola', segmento: 'PADARIA', endereco: 'Rua Frederico Ozanan, 153', bairro: 'Jardim Pérola', potencial: 'MEDIO', fonte: 'qualotelefone' }),
  L({ nome_fantasia: 'Panificadora Sonho Real', segmento: 'PADARIA', endereco: 'Rua Gilson Motta, 30', bairro: 'Nova JK', potencial: 'MEDIO', fonte: 'qualotelefone' }),
  L({ nome_fantasia: 'Padaria Styllus', segmento: 'PADARIA', endereco: 'Rua Monte Sião, 321', bairro: 'Vila dos Montes', potencial: 'MEDIO', fonte: 'qualotelefone' }),
  L({ nome_fantasia: 'Panificação Betel', segmento: 'PADARIA', endereco: 'Rua Israel Pinheiro, 2105', bairro: 'São Pedro', potencial: 'MEDIO', fonte: 'qualotelefone' }),
  L({ nome_fantasia: 'Padaria Monpane Grã-Duquesa', segmento: 'PADARIA', bairro: 'Grã-Duquesa', potencial: 'MEDIO', fonte: 'Apontador' }),
  L({ nome_fantasia: 'Padaria Reis', segmento: 'PADARIA', endereco: 'Av. Wenceslau Braz, 2235', bairro: 'Santa Rita', potencial: 'MEDIO', fonte: 'empresasembrasil' }),

  // ——— HOTÉIS / POUSADAS ———
  L({ nome_fantasia: 'Benvenuto Palace Hotel', segmento: 'HOTEL', endereco: 'Av. Minas Gerais, 701', telefone: '(33) 3271-2023', potencial: 'ALTO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'Pousada Jeito de Minas', segmento: 'HOTEL', endereco: 'Rua Trinta e Dois, 93', telefone: '(33) 3276-7797', potencial: 'MEDIO', fonte: 'Portal Minas Gerais' }),

  // ——— ADEGAS / DEPÓSITOS (varejo de bebidas — potenciais clientes ou concorrentes) ———
  L({ nome_fantasia: 'M & S Comércio de Bebidas', segmento: 'ADEGA', bairro: 'Morada do Acampamento', potencial: 'MEDIO', fonte: 'maisdireto' }),
  L({ nome_fantasia: 'Tele Cerveja JK', segmento: 'ADEGA', endereco: 'Av. JK, 2189', bairro: 'Vila Rica', potencial: 'MEDIO', fonte: 'listatudo' }),
  L({ nome_fantasia: 'Tele Cerveja do Careca', segmento: 'ADEGA', endereco: 'Rua Gonçalo Costa, 431', bairro: 'Nossa Senhora das Graças', potencial: 'MEDIO', fonte: 'listatudo' }),
  L({ nome_fantasia: 'Chiquinho Bebidas e Balas', segmento: 'ADEGA', endereco: 'Rua José Luiz Nogueira, 645', bairro: 'Centro', telefone: '(33) 3271-7029', potencial: 'MEDIO', fonte: 'guiatelefone' }),
  L({ nome_fantasia: 'Boutique da Cachaça e Adega Mineira', segmento: 'ADEGA', endereco: 'Rua Marechal Deodoro, 587', bairro: 'Centro', potencial: 'MEDIO', fonte: 'listatudo' }),
  L({ nome_fantasia: 'Kribel Distribuidora de Bebidas', segmento: 'ADEGA', endereco: 'Rua Nizio Peçanha Barcelos', bairro: 'Vila Isa', telefone: '(33) 3278-306x', potencial: 'BAIXO', observacoes: 'Concorrente / atacado — avaliar parceria ou não abordar', fonte: 'inteligue' }),
  L({ nome_fantasia: 'Pirâmide Distribuidora', segmento: 'ADEGA', endereco: 'Rua José Luiz Nogueira', bairro: 'Centro', telefone: '(33) 3221-050x', potencial: 'BAIXO', observacoes: 'Concorrente potencial', fonte: 'inteligue' }),
  L({ nome_fantasia: 'Zambez Bebidas', segmento: 'ADEGA', endereco: 'Rua Caio Martins', bairro: 'Centro', telefone: '(33) 3221-998x', potencial: 'BAIXO', fonte: 'inteligue' }),
  L({ nome_fantasia: 'Rosa Comércio e Distribuidora de Bebidas e Queijos', segmento: 'ADEGA', endereco: 'Rua Afonso Pena, 2061', bairro: 'Centro', potencial: 'MEDIO', fonte: 'acharei' }),

  // ——— EVENTOS ———
  L({ nome_fantasia: 'Arena Praia GV', segmento: 'EVENTOS', endereco: 'Rua Israel Pinheiro, 1345', telefone: '(33) 99943-1069', potencial: 'ALTO', fonte: 'Portal Minas Gerais' }),
  L({ nome_fantasia: 'GvBartenders', segmento: 'EVENTOS', telefone: '(33) 8805-7962', potencial: 'MEDIO', fonte: 'organizandoeventos', observacoes: 'Serviço de bar para eventos' }),
];

console.log('Xiquim Vargas Caça Leads — mapeamento Governador Valadares');
console.log(`Candidatos a inserir: ${LEADS.length}`);
const result = importRows(LEADS.map((row) => ({ ...row, tags: ['mapa-gv', 'publico', (row.segmento || '').toLowerCase()] })));
const stats = listLeads().reduce((counts, row) => {
  counts[row.segmento] = (counts[row.segmento] || 0) + 1;
  return counts;
}, {});
console.log('Inseridos agora:', result.added, '| Ignorados (já existiam):', LEADS.length - result.added);
console.log('Total visível no aplicativo:', result.total);
console.log('Por segmento:', Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([segmento, total]) => `${segmento}:${total}`).join(' | '));
console.log('OK');
