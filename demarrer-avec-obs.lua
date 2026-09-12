-- ============================================================
--  7GIONNY - Lancement auto du pont au demarrage d'OBS
-- ============================================================
--  Quand OBS demarre, ce script lance automatiquement :
--    1. le pont (le petit serveur qui affiche l'overlay)
--    2. le panneau de controle dans ton navigateur
--
--  Tu n'as RIEN d'autre a faire : lance OBS normalement,
--  et tout se met en route tout seul.
-- ============================================================

local obs = obslua

function script_description()
	return [[
	<h2>7GIONNY — Lancement auto du pont</h2>
	<p>Au démarrage d'OBS, ce script lance automatiquement :</p>
	<ul>
		<li>le <b>pont</b> (le serveur de l'overlay, fenêtre noire)</li>
		<li>le <b>panneau de contrôle</b> dans ton navigateur</li>
	</ul>
	<p>Tu peux laisser OBS se lancer normalement, tout se met en route tout seul.</p>
	]]
end

-- Retourne le dossier qui contient ce script (avec le separateur a la fin)
local function dossier_du_script()
	local p = script_path()
	-- au cas ou script_path() renverrait le chemin complet du fichier :
	if p:match("%.lua$") then
		p = p:match("^(.*[/\\])") or p
	end
	if not p:match("[/\\]$") then
		p = p .. "\\"
	end
	return p
end

function script_load(settings)
	local bat = dossier_du_script() .. "lancer-pont-auto.bat"
	-- lance le fichier .bat dans une fenetre separee, sans bloquer OBS
	local cmd = 'start "" "' .. bat .. '"'
	obs.script_log(obs.LOG_INFO, "Lancement du pont : " .. cmd)
	os.execute(cmd)
end
