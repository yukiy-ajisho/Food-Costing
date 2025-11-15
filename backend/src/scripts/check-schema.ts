import { supabase } from "../config/supabase";

/**
 * データベーススキーマを確認するスクリプト
 * 必要なテーブルが全て存在するか確認
 */
async function checkSchema() {
  console.log("Checking database schema...\n");

  const requiredTables = [
    "items",
    "recipe_lines",
    "item_unit_profiles",
    "labor_roles",
    "non_mass_units",
  ];

  for (const table of requiredTables) {
    try {
      const { data, error } = await supabase.from(table).select("*").limit(0);

      if (error) {
        console.error(
          `❌ Table "${table}" does not exist or is not accessible`
        );
        console.error(`   Error: ${error.message}`);
      } else {
        console.log(`✅ Table "${table}" exists`);
      }
    } catch (err) {
      console.error(`❌ Error checking table "${table}":`, err);
    }
  }

  console.log("\nSchema check complete!");
}

// スクリプト実行
checkSchema()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
