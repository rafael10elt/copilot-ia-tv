# 📓 DIÁRIO DE BORDO & PLAYBOOK DE OPERAÇÕES - LUMI COPILOT

**Trader Operador:** Mesa Proprietária NASDAQ (NQ / MNQ)  
**Base Geográfica:** Dublin, Irlanda (Fuso: GMT / IST)  
**Janelas Oficiais de Operação:**
- **Manhã (Londres):** 08h15 às 11h00 (Dublin)
- **Tarde (Wall Street Power Hour):** 18h15 às 20h45 (Dublin)  
*(Estudos: 13h00 às 17h00 - Sem exposição de ordens durante a abertura de NY)*

---

## 🏛️ REGRAS DE OURO PARA MESA PROPRIETÁRIA (APEX / TOPSTEP / MFF)

1. **Risco Máximo por Operação (1R):** $100 fixos.
   - Stop de 15 pontos no MNQ = 10 contratos ($100).
   - Stop de 15 pontos no NQ = 0.33 (operar apenas MNQ para precisão de lote).
2. **Limite de Perda Diária:** Parar o dia imediatamente ao atingir -$300 (3 derrotas seguidas).
3. **Trailing Drawdown:** Jamais tentar recuperar loss durante o horário do almoço de NY (17h-18h Dublin).
4. **Fechamento Obrigatório:** Nenhuma posição pode ficar aberta após as 20h55 de Dublin (15h55 NY). Risco de quebra imediata da conta por regra de *overnight*.
5. **Notícias 3 Estrelas:** Zerar ou pausar 5 minutos antes de eventos HIGH de USD (CPI, FOMC, NFP).

---

## 🧭 CHANGELOG E RODADAS DE DESENVOLVIMENTO

### [Round 3] - Conclusão do Cockpit Integrado
- **Novo Banco de Dados:** Criadas tabelas com sufixo `_cop` para isolar dados de testes anteriores.
- **Leitor de Notícias 3 Estrelas:** Conectado à API oficial e gratuita da FairEconomy/ForexFactory. Alerta sonoro duplo e distintivo para notícias de alto impacto em USD e EUR.
- **Scanner Groq Vision:** Leitura com 1 clique de prints do otimizador do TradingView usando `llama-3.2-11b-vision-preview`, extraindo os melhores setups em JSON estrito.
- **Gestão de Contas de Mesa:** Módulo completo para acompanhar tamanho da conta, custo do teste, status de aprovação e histórico de saques realizados.
- **Diário de Trades:** Registro de operações com verificação de disciplina e cálculo automático de R e financeiro.
- **Atualização da Sentinela Python:** Ajustado `sentinel.py` para sincronizar exclusivamente nas tabelas `_cop`.

### [Round 4] - Cockpit enxuto, focado na Sentinela OpenCV
- **Módulo de Execução Tática removido:** saíram a ponte Tradovate/Apex do frontend, a seleção de contas, os presets de stop/lote e o relatório de execução. As entradas voltam a ser 100% manuais na plataforma.
- **Scanner Groq Vision removido:** a chave foi descontinuada; saíram o upload de prints, o modal de API Key e a validação de modelos de visão.
- **Setups do Otimizador removidos:** saíram o card "Setups Extraídos do Otimizador" e a Rotina das Operações (varredura macro / score de prop).
- **Abas Mesas e Diário removidas:** o frontend agora opera somente com o Cockpit.
- **Alerta Verde/Vermelho:** quando a visão computacional identifica verde (BUY) ou vermelho (SELL), o Cockpit exibe faixa visual piscante com direção, ativo e horário, além do alarme sonoro de 30s (sirene ascendente para compra e descendente para venda). O som é armável no header e a preferência fica no `localStorage`.
- **Heartbeat da Sentinela:** status ONLINE/OFFLINE real baseado em `last_seen`, marcando "SINAL PERDIDO" após 60s sem frame.