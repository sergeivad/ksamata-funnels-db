"""
Замер совместимости двух наборов меток у шестнадцати легаси-воронок LEAK.

Вопрос владельца: если привести метки f6–f26 в LEAK к АВ-слою, будут ли заказы
отбираться так же, как сейчас по старым меткам.

Метод. Для каждой воронки берём два предиката и прогоняем по одним и тем же
заказам полной выгрузки (все заказы с 1 января):

  L — набор LEAK как есть: заказ подходит, если ВСЕ метки набора есть среди его
      меток. Ровно так LEAK и отбирает: `required_offer_tags`.
  A — АВ-набор из базы (сценарий оплаты без оси времени).

Сравниваем множества ID заказов. Совпали — переход безопасен; разошлись —
показываем, в какую сторону и на сколько.

Метки ищем и в «Тегах» заказа, и в «Тегах предложений»: LEAK смотрит оба поля
(`order_tags_field` + `offer_tags_field` в applicationRuleJson), значит и замер
должен смотреть оба, иначе он мерил бы не то правило.

Сравнение регистронезависимое и с ё→е: в LEAK метки записаны строчными
(«яндекс ретаргет»), в базе — как в GetCourse («Яндекс Ретаргет»). Это разница
записи, а не смысла, и делать из неё расхождение было бы ложной находкой.
"""
import csv, json, sys
from collections import defaultdict

S = "."  # каталог с deals.csv (пять колонок из полной выгрузки deal_export)

def norm(s: str) -> str:
    return s.strip().lower().replace("ё", "е")

sets = json.load(open(f"{S}/tagsets.json"))
targets = {}
for code, v in sets.items():
    av = {norm(t) for t in v["avTags"]}
    targets[code] = {
        "num": v["num"], "status": v["status"],
        "L": {norm(t) for t in v["leakTags"]},
        "A": av,
        # Тот же АВ-набор без этапа. Нужен затем, что в наборе LEAK этапа нет
        # вовсе: `required_offer_tags` отбирает ЗАЯВКИ воронки, а оплату LEAK
        # считает отдельным правилом. Сравнивать L с A напрямую — значит мерить
        # разные вещи: A уже на целый этап. Настоящий вопрос «те же ли заказы
        # отберутся по осям» отвечает пара L ↔ Ao.
        "Ao": {t for t in av if not t.startswith("ав этап")},
    }

hitL = defaultdict(set)
hitA = defaultdict(set)
hitAo = defaultdict(set)
total = 0
tagged = 0

csv.field_size_limit(10 ** 7)
with open(f"{S}/deals.csv", encoding="utf-8") as fh:
    r = csv.reader(fh)
    header = next(r)
    for row in r:
        if len(row) < 5:
            continue
        oid, created, status, otags, ptags = row[0], row[1], row[2], row[3], row[4]
        total += 1
        # Разделитель меток в выгрузке — «|», НЕ запятая: сами метки содержат
        # запятые и двоеточия («АВ Канал: Яндекс»). Первая версия замера делила
        # по запятой и дала ноль совпадений по всем шестнадцати воронкам —
        # ровный ноль и был признаком ошибки разбора, а не находкой.
        # Объединяем оба поля: LEAK смотрит и «Теги», и «Теги предложений».
        tags = {norm(t) for t in (otags + "|" + ptags).split("|") if t.strip()}
        if not tags:
            continue
        tagged += 1
        for code, t in targets.items():
            if t["L"] <= tags:
                hitL[code].add(oid)
            if t["A"] <= tags:
                hitA[code].add(oid)
            if t["Ao"] <= tags:
                hitAo[code].add(oid)

print(f"заказов в выгрузке: {total}, с метками: {tagged}\n")
print("Сравнение по ОСЯМ (этап снят с обеих сторон) — отвечает на вопрос,")
print("те же ли заказы отберутся, если перевести LEAK на АВ-слой.\n")
print(f"{'код':>5} {'num':>4} {'статус':<8} {'LEAK':>7} {'АВ':>7} {'только LEAK':>12} {'только АВ':>10}  вердикт")
rows = []
for code in sorted(targets, key=lambda x: int(x[1:])):
    L, Ao, A = hitL[code], hitAo[code], hitA[code]
    onlyL, onlyA = L - Ao, Ao - L
    if not L and not Ao:
        verdict = "заказов нет ни по одному"
    elif L == Ao:
        verdict = "совпали"
    elif not Ao:
        verdict = "АВ не находит ничего"
    elif not L:
        verdict = "LEAK не находит ничего"
    elif L < Ao:
        verdict = "АВ шире"
    elif Ao < L:
        verdict = "АВ уже"
    else:
        verdict = "расходятся в обе стороны"
    t = targets[code]
    print(f"{code:>5} {t['num']:>4} {t['status']:<8} {len(L):>7} {len(Ao):>7} {len(onlyL):>12} {len(onlyA):>10}  {verdict}")
    rows.append(dict(code=code, num=t["num"], status=t["status"],
                     leak=len(L), avNoStage=len(Ao), avPayment=len(A),
                     onlyLeak=len(onlyL), onlyAv=len(onlyA), verdict=verdict))

json.dump(rows, open(f"{S}/measure.json", "w"), ensure_ascii=False, indent=1)
same = sum(1 for x in rows if x["verdict"] == "совпали")
print(f"\nсовпали по осям: {same} из {len(rows)}")
print("\nСколько из отобранных — оплаты (АВ Этап: Оплата), для справки:")
for r in rows:
    if r["avNoStage"]:
        print(f"  {r['code']:>5}: по осям {r['avNoStage']:>6}, из них оплат {r['avPayment']:>6}")
