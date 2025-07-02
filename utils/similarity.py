from difflib import SequenceMatcher
# using SequenceMatcher it is a character-based sequence alignment algorith, to check the similarity score.

################################################################################################
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
# Cosine Similarity with TF-IDF

def calculate_cosine_similarity(text1, text2):
    vectorizer = TfidfVectorizer().fit_transform([text1, text2])
    vectors = vectorizer.toarray()
    score = cosine_similarity([vectors[0]], [vectors[1]])[0][0]
    return round(score * 100, 2)  # return as a percentage
################################################################################################

def calculate_similarity(text1, text2):
    return round(SequenceMatcher(None, text1, text2).ratio() * 100, 2)

def highlight_matches(text1, text2):
    matcher = SequenceMatcher(None, text1, text2)
    
    # Highlight for original
    highlighted1 = ""
    last1 = 0

    # Highlight for resubmitted
    highlighted2 = ""
    last2 = 0

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            match1 = f"<span class='match-highlight'>{text1[i1:i2]}</span>"
            match2 = f"<span class='match-highlight'>{text2[j1:j2]}</span>"
        else:
            match1 = text1[i1:i2]
            match2 = text2[j1:j2]

        highlighted1 += match1
        highlighted2 += match2

    return highlighted1, highlighted2

