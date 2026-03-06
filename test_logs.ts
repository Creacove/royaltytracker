import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.log("Missing env vars in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .from("artist_ai_turn_logs_v1")
        .select("created_at, question, analysis_plan, sql_text, verifier_status, insufficiency_reason")
        .order("created_at", { ascending: false })
        .limit(3);

    if (error) {
        console.error("DB Error:", error.message);
    } else {
        for (const row of data) {
            console.log(`\n--- ${row.created_at} ---`);
            console.log(`Q: ${row.question}`);
            console.log(`Status: ${row.verifier_status} | Reason: ${row.insufficiency_reason}`);
            console.log(`Plan:`, row.analysis_plan);
            console.log(`SQL:\n${row.sql_text}`);
        }
    }
}

check();
