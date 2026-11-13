// Categories and settings a new profile starts with, and how stored settings
// are read back. Pure: no DOM, no storage.
(function attachProfileDefaults(global) {
  const descriptionOptionsByType = Object.freeze({
    ALIMENTAÇÃO: Object.freeze(["DELIVERY", "RESTAURANTE", "SUPERMERCADO"]),
    ASSINATURAS: Object.freeze(["OUTRAS ASSINATURAS", "SOFTWARE", "STREAMING"]),
    COMPRAS: Object.freeze(["CASA", "ELETRÔNICOS", "PRESENTES", "ROUPAS"]),
    EDUCAÇÃO: Object.freeze(["CURSOS", "MATERIAL", "MENSALIDADE"]),
    FINANCEIRO: Object.freeze(["EMPRÉSTIMO", "FINANCIAMENTO", "IMPOSTOS", "TARIFAS"]),
    LAZER: Object.freeze(["ENTRETENIMENTO", "PASSEIOS", "VIAGENS"]),
    MORADIA: Object.freeze(["ÁGUA", "ALUGUEL", "CONDOMÍNIO", "ENERGIA", "GÁS", "INTERNET", "MANUTENÇÃO"]),
    OUTROS: Object.freeze(["OUTROS"]),
    RECEITAS: Object.freeze(["BENEFÍCIOS", "FREELANCE", "REEMBOLSO", "RENDIMENTOS", "SALÁRIO"]),
    SAÚDE: Object.freeze(["CONSULTAS", "FARMÁCIA", "PLANO DE SAÚDE"]),
    TRANSPORTE: Object.freeze(["APLICATIVOS", "COMBUSTÍVEL", "MANUTENÇÃO", "SEGURO", "TRANSPORTE PÚBLICO"]),
  });
  const defaultTypes = Object.freeze(Object.keys(descriptionOptionsByType));
  const defaultDescriptions = Object.freeze([...new Set(Object.values(descriptionOptionsByType).flat())].sort());

  // A new profile has no invented balance: it starts at zero, dated today.
  function createDefaultSettings(today) {
    return { current_balance: 0, balance_reference_date: today, onboarding_status: "pending" };
  }

  function normalizeSettings(settings = {}, today) {
    return {
      current_balance: Number(settings.current_balance ?? 0),
      balance_reference_date: settings.balance_reference_date || today,
      onboarding_status: ["pending", "completed"].includes(settings.onboarding_status)
        ? settings.onboarding_status
        : null,
    };
  }

  // A profile that saved its own list keeps exactly that list; defaults only
  // fill a profile that never had one.
  function profileOptions(savedOptions, defaults) {
    return Array.isArray(savedOptions) ? [...new Set(savedOptions)].sort() : [...defaults];
  }

  global.MGProfileDefaults = {
    descriptionOptionsByType,
    defaultTypes,
    defaultDescriptions,
    createDefaultSettings,
    normalizeSettings,
    profileOptions,
  };
})(window);
