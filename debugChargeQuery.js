const db = require('./config/database');
(async()=>{
  await db.authenticate();
  const query = `
    SELECT *,
    (
      (CASE
         WHEN user_id IS NOT NULL AND user_id = $1 THEN 16
         ELSE 0
       END) +
      (CASE
         WHEN franchaise_id IS NOT NULL AND franchaise_id = $2 THEN 8
         ELSE 0
       END) +
      (CASE WHEN card_classification IS NOT NULL THEN 4 ELSE 0 END) +
      (CASE WHEN card_brand IS NOT NULL THEN 2 ELSE 0 END) +
      (CASE WHEN card_type IS NOT NULL THEN 1 ELSE 0 END)
    ) AS specificity
    FROM pos_charge_rules
    WHERE is_active = true
      AND (
            (user_id = $1)
         OR (user_id IS NULL AND (franchaise_id = $2 OR franchaise_id IS NULL))
      )
      AND (payment_mode = $3 OR payment_mode IS NULL)
      AND (card_type = $4 OR card_type IS NULL)
      AND (card_brand = $5 OR card_brand IS NULL)
      AND (card_classification = $6 OR card_classification IS NULL)
      AND (settlement_type = $7 OR settlement_type IS NULL)
      AND $8 >= min_amount
      AND ($8 <= max_amount OR max_amount IS NULL)
    ORDER BY specificity DESC
    LIMIT 1
  `;
  const replacements = [7,5,'CARD','CREDIT','VISA','PLATINUM','TODAY',100];
  console.log('replacements', replacements);
  const [results] = await db.query(query, { bind: replacements, type: db.QueryTypes.SELECT, logging: console.log });
  console.log('raw results', results);
})();