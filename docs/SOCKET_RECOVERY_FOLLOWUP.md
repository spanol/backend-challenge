# Pendência: conexão interrompida na demo

Registrada em 14/10/2026 a pedido do usuário. Investigar depois do refino do vídeo.

Mensagem observada na demo pública:

> The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch(). Use “Retomar operação pendente” para reenviar a mesma identidade.

A leitura da página encontrou a rodada 48730 encerrada com confirmação interrompida e uma operação pendente. Nenhuma retomada, nova rodada, recarga ou alteração financeira foi executada durante a captura editorial. O usuário relata que a falha ocorre às vezes; frequência e causa ainda não foram determinadas.

A investigação deve correlacionar o instante da falha entre coordenador, API, proxy e PostgreSQL; distinguir desconexão antes/depois do commit; examinar timeouts, keep-alive, reutilização de conexão e cancelamento do fetch. Diagnóstico detalhado do Bun deve ficar restrito a uma reprodução controlada, sem logs públicos com dados privados.

Verificar que a operação incerta conserva chave, identidade externa e payload, que o retry recupera o resultado sem novo efeito e que a rodada não avança enquanto existir liquidação pendente. Cobrir a perda de resposta após commit e a desconexão antes de persistir com cenários reais no runner isolado, sem modificar o banco principal.

Fontes: observação da demo pública em 14/10/2026, relato do usuário e contrato de recuperação em [ARCHITECTURE](../ARCHITECTURE.md) e [DEMO](DEMO.md). Trata-se de uma pendência, não de diagnóstico concluído.
