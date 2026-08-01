(function attachRepository(global) {
  function create(client) {
    return {
      async fetchEntries(pageSize = 1000) {
        const entries = [];
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await client.from("entries")
            .select("id, date, value, type, description, detail, paid, installment, flow_type, series_id, scheduled_date, detached_from_series, excluded_from_series, created_at, updated_at")
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
      async upsertEntries(entries, userId) {
        if (!entries.length) return [];
        const payload = entries.map((entry) => ({ ...entry, user_id: userId }));
        const { data, error } = await client.from("entries")
          .upsert(payload).select("id, updated_at");
        if (error) throw error;
        return data;
      },
      async fetchRecurrenceSeries() {
        const { data, error } = await client.from("recurrence_series")
          .select("id, flow_type, frequency, interval_value, custom_unit, weekdays, start_date, end_mode, end_date, occurrence_count, business_day_adjustment, value, type, description, detail, active, created_at, updated_at")
          .order("start_date", { ascending: true }).order("id", { ascending: true });
        if (error) throw error;
        return data;
      },
      async fetchRecurrenceSeriesVersion(id) {
        const { data, error } = await client.from("recurrence_series")
          .select("updated_at").eq("id", id).maybeSingle();
        if (error) throw error;
        return data;
      },
      async upsertRecurrenceSeries(series, userId) {
        const { data, error } = await client.from("recurrence_series")
          .upsert({ ...series, user_id: userId })
          .select("id, updated_at").single();
        if (error) throw error;
        return data;
      },
      async deleteRecurrenceSeries(id, userId) {
        const { error } = await client.from("recurrence_series")
          .delete().eq("id", id).eq("user_id", userId);
        if (error) throw error;
      },
      async deleteGeneratedEntries(seriesId, userId, fromScheduledDate = null) {
        let query = client.from("entries").delete()
          .eq("series_id", seriesId)
          .eq("user_id", userId)
          .eq("detached_from_series", false);
        if (fromScheduledDate) query = query.gte("scheduled_date", fromScheduledDate);
        const { error } = await query;
        if (error) throw error;
      },
      async deleteSeriesEntries(seriesId, userId, fromScheduledDate = null) {
        let query = client.from("entries").delete()
          .eq("series_id", seriesId)
          .eq("user_id", userId);
        if (fromScheduledDate) query = query.gte("scheduled_date", fromScheduledDate);
        const { error } = await query;
        if (error) throw error;
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
      subscribeToEntries(userId, onChange, onStatus) {
        return client
          .channel(`entries:${userId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "entries",
              filter: `user_id=eq.${userId}`,
            },
            onChange,
          )
          .subscribe(onStatus);
      },
      removeChannel(channel) {
        if (channel) client.removeChannel(channel);
      },
    };
  }

  global.MGSupabaseRepository = { create };
})(window);
