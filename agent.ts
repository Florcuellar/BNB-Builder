import { createAgent } from '@bnb-chain/agent-studio';

// Configuración del Agente Autónomo de Monitoreo
const agent = createAgent({
  name: 'StockMonitorAgent',
  purpose: 'Monitorear acciones tokenizadas en BNB Chain y ejecutar acciones ante alta volatilidad',
  
  // Identidad y Wallet
  wallet: {
    type: 'evm-local', // Wallet local propia del agente
  },
  
  // Modelo LLM para toma de decisiones
  llm: {
    provider: 'pieverse',
    model: 'auto/free', // Modelo gratuito para fase de desarrollo
  },

  // Reglas en lenguaje natural
  instructions: `
    Eres un agente financiero autónomo.
    1. Revisa continuamente los eventos onchain de acciones tokenizadas.
    2. Si detectas una variación mayor al 5%, evalúa el riesgo usando tu LLM.
    3. Firma y ejecuta la orden correspondiente usando tu wallet si se cumplen las condiciones.
  `
});

async function main() {
  console.log('Iniciando agente...');
  await agent.start();
}

main().catch(console.error);
