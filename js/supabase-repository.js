(function attachRepository(global) {
  function create(client) {
    return {
      async fetchEntries(pageSize = 1000) {
        const entries = [];
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await client.from("entries")
            .select("id, date, value, type, description, detail, paid, installment, created_at, updated_at")
            .order("date", { ascending: true }).order("id", { ascending: true })
            .range(from, from + pageSize - 1);
          if (error) throw error;
          entries.push(...data);
          if (data.length < pageSize) return entries;
        }
      },
      async fetchEntryVersion(id) {
        const { data, error } = await client.from("entries").select("updated_at").eq("id", id).maybeSingle();
        if (error) throw error;
        return data;
      },
      async deleteEntry(id, userId) {
        const { error } = await client.from("entries").delete().eq("id", id).eq("user_id", userId);
        if (error) throw error;
      },
      async upsertEntry(entry, userId) {
        const { data, error } = await client.from("entries")
          .upsert({ ...entry, user_id: userId }).select("id, updated_at").single();
        if (error) throw error;
        return data;
      },
      async fetchSettings() {
        const { data, error } = await client.from("financial_settings")
          .select("current_balance, balance_reference_date, income_day_15, income_last_business_day, types, descriptions")
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      async upsertSettings(userId, settings, types, descriptions) {
        const { error } = await client.from("financial_settings").upsert(
          { user_id: userId, ...settings, types, descriptions }, { onConflict: "user_id" },
        );
        if (error) throw error;
      },
    };
  }

  global.MGSupabaseRepository = { create };
})(window);
