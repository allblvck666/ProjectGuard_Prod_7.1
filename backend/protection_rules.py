"""Shared, storage-independent validation for protection create/edit/restore."""
import json
import math
import re


def sku_code(value):
    value = re.sub(r"\([^)]*\)", "", str(value or ""))
    value = re.sub(r"\s*[—–]\s*[\d.,]+\s*м[²2]\s*$", "", value, flags=re.I)
    return re.sub(r"\s+", "", value).upper()


def positive_area(value):
    try:
        area = float(value)
    except (TypeError, ValueError):
        raise ValueError("Укажите площадь защиты") from None
    if not math.isfinite(area) or area <= 0:
        raise ValueError("Площадь должна быть положительным числом")
    return area


def sku_pairs(display, total):
    """Parse both historical display formats, including one per-SKU item."""
    pairs = {}
    for part in re.split(r"\s*;\s*|\s+\+\s+", str(display or "")):
        match = re.search(r"\s*[—–]\s*([\d.,]+)\s*м[²2]\s*$", part, re.I)
        try:
            area = positive_area(match.group(1).replace(",", ".") if match else total)
        except ValueError:
            continue
        code = sku_code(part)
        if code and code != "—":
            # Multiple rows of the same SKU share one protected material area.
            # A repeated SKU in the unified-area format still uses the total once.
            pairs[code] = pairs.get(code, 0) + area if match else max(pairs.get(code, 0), area)
    return list(pairs.items())


def material_values(data, validate_limits=True):
    items = data.get("sku_data") or []
    if items:
        items = [item.model_dump() if hasattr(item, "model_dump") else item for item in items]
        if validate_limits and len(items) > 3:
            raise ValueError("Можно добавить максимум 3 артикула")
        per_sku = any(item.get("area") is not None for item in items)
        parts = []
        seen = set()
        total = 0.0 if per_sku else positive_area(data.get("area_m2"))
        for item in items:
            code = str(item.get("sku") or "").strip()
            kind = str(item.get("type") or "").strip()
            if not code or any(separator in code for separator in (";", "+", "(", ")", "\n", "\r", " — ")):
                raise ValueError("Укажите корректный артикул для каждого материала")
            if any(separator in kind for separator in (";", "+", "(", ")", "\n", "\r")):
                raise ValueError("Укажите корректный тип материала")
            key = (sku_code(code), kind.casefold())
            if validate_limits and key in seen:
                raise ValueError("Один артикул с одинаковым типом нельзя добавить дважды")
            seen.add(key)
            label = f"{code} ({kind})" if kind else code
            if per_sku:
                area = positive_area(item.get("area"))
                total += area
                label += f" — {area:g} м²"
            parts.append(label)
        display = ("; " if per_sku else " + ").join(parts)
    else:
        display = str(data.get("sku") or "").strip()
        total = positive_area(data.get("area_m2"))
        if not sku_pairs(display, total):
            raise ValueError("Добавьте хотя бы один материал")
        parts = re.split(r"\s*;\s*|\s+\+\s+", display)
        if validate_limits:
            if len(parts) > 3:
                raise ValueError("Можно добавить максимум 3 артикула")
            seen = set()
            for part in parts:
                code = sku_code(part)
                kind = re.search(r"\(([^)]*)\)", part)
                key = (code, kind.group(1).strip().casefold() if kind else "")
                if not code or part.count("(") != part.count(")"):
                    raise ValueError("Укажите корректный артикул для каждого материала")
                if key in seen:
                    raise ValueError("Один артикул с одинаковым типом нельзя добавить дважды")
                seen.add(key)
        areas = [re.search(r"\s*[—–]\s*([\d.,]+)\s*м[²2]\s*$", part, re.I) for part in parts]
        if any(areas):
            if not all(areas):
                raise ValueError("Укажите площадь для каждого материала")
            calculated = sum(positive_area(match.group(1).replace(",", ".")) for match in areas)
            if not math.isclose(total, calculated, rel_tol=1e-6, abs_tol=0.001):
                raise ValueError("Общая площадь должна совпадать с суммой площадей материалов")
    if total < 50:
        raise ValueError("Защита ставится от 50 м²")
    return display, total


def materials_conflict(display, total, existing_display, existing_total):
    """A common SKU with its own area within ±10% of the existing area."""
    existing = sku_pairs(existing_display, existing_total)
    return any(code == other and area * 0.9 <= candidate <= area * 1.1
               for code, candidate in sku_pairs(display, total)
               for other, area in existing)


def can_manage(user, protection, dictionary_manager_id=None):
    if user.get("role") in ("admin", "superadmin"):
        return True
    author_id = protection.get("manager_id")
    if author_id is not None and str(user.get("id")) == str(author_id):
        return True
    if user.get("role") != "assistant":
        return False
    # The legacy single manager_id references a user, whereas manager_ids
    # references the separate manager directory. Never compare the two ID sets.
    if author_id is not None and user.get("manager_id") is not None:
        if str(user["manager_id"]) == str(author_id):
            return True
    try:
        assigned = user.get("manager_ids") or []
        assigned = json.loads(assigned) if isinstance(assigned, str) else assigned
    except (ValueError, TypeError):
        return False
    return (isinstance(assigned, list) and dictionary_manager_id is not None
            and str(dictionary_manager_id) in {str(value) for value in assigned if value is not None})
